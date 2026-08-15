import { BadRequestException, Injectable } from '@nestjs/common';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Потолки транскода — прямые аналоги MAX_SIDE/QUALITY у фото (ImageService).
// 1080p по длинной стороне, без апскейла: вертикальное видео 1080×1920 остаётся собой.
const MAX_WIDTH = 1920;
const MAX_HEIGHT = 1080;
// CRF 26 ≈ «сжать до 80% качества»: у x264 это заметно меньший файл при том же
// визуальном уровне, что webp q80 у фото.
const CRF = 26;
const MAX_DURATION_SEC = 60;
// Транскод идёт в единственном воркере на одной реплике: подвисший ffmpeg
// заблокировал бы очередь навсегда.
const FFMPEG_TIMEOUT_MS = 10 * 60 * 1000;

export interface VideoProbe {
  durationSec: number;
  width: number;
  height: number;
}

export interface TranscodedVideo {
  /** mp4 (h264+aac, faststart). */
  video: Buffer;
  /** Кадр на первой секунде, ещё не сжатый — дальше идёт в ImageService.toWebp. */
  posterPng: Buffer;
}

// Запускает бинарник и собирает stdout. Ошибки ffmpeg попадают в stderr, поэтому
// его тоже копим — без него в логах остаётся только «exit code 1».
function run(
  bin: string,
  args: string[],
): Promise<{ stdout: Buffer; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args);
    const stdout: Buffer[] = [];
    let stderr = '';

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`${bin}: превышен таймаут ${FFMPEG_TIMEOUT_MS} мс`));
    }, FFMPEG_TIMEOUT_MS);

    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve({ stdout: Buffer.concat(stdout), stderr });
        return;
      }
      reject(
        new Error(`${bin} завершился с кодом ${code}: ${stderr.slice(-500)}`),
      );
    });
  });
}

interface FfprobeOutput {
  format?: { duration?: string };
  streams?: { codec_type?: string; width?: number; height?: number }[];
}

@Injectable()
export class VideoService {
  /**
   * Проверяет, что файл — действительно видео и влезает в лимит длительности.
   * Как и у фото, доверяем не клиентскому mimetype, а разбору содержимого.
   */
  async probe(path: string): Promise<VideoProbe> {
    let parsed: FfprobeOutput;
    try {
      const { stdout } = await run('ffprobe', [
        '-v',
        'error',
        '-print_format',
        'json',
        '-show_format',
        '-show_streams',
        path,
      ]);
      parsed = JSON.parse(stdout.toString()) as FfprobeOutput;
    } catch {
      throw new BadRequestException('Не удалось прочитать видео');
    }

    const stream = parsed.streams?.find((s) => s.codec_type === 'video');
    if (!stream?.width || !stream.height) {
      throw new BadRequestException('В файле нет видеодорожки');
    }

    const durationSec = Number(parsed.format?.duration ?? 0);
    if (!Number.isFinite(durationSec) || durationSec <= 0) {
      throw new BadRequestException('Не удалось определить длительность видео');
    }
    if (durationSec > MAX_DURATION_SEC) {
      throw new BadRequestException(
        `Видео длиннее ${MAX_DURATION_SEC} секунд не принимается`,
      );
    }

    return { durationSec, width: stream.width, height: stream.height };
  }

  /**
   * Перекодирует в mp4 и вынимает кадр для обложки. Работает через временную
   * директорию: ffmpeg с `-movflags +faststart` переписывает начало файла в конце
   * работы, поэтому в pipe вывод не отдаётся — нужен именно файл на диске.
   */
  async transcode(
    inputPath: string,
    probe: VideoProbe,
  ): Promise<TranscodedVideo> {
    const dir = await mkdtemp(join(tmpdir(), 'stealth-video-'));
    const outputPath = join(dir, 'out.mp4');
    try {
      await run('ffmpeg', [
        '-y',
        '-i',
        inputPath,
        // Вписываем в MAX_WIDTH×MAX_HEIGHT с сохранением пропорций и БЕЗ апскейла
        // (аналог withoutEnlargement у sharp). Чётность сторон обязательна для h264.
        '-vf',
        `scale='min(${MAX_WIDTH},iw)':'min(${MAX_HEIGHT},ih)':force_original_aspect_ratio=decrease:force_divisible_by=2`,
        '-c:v',
        'libx264',
        '-crf',
        String(CRF),
        '-preset',
        'veryfast',
        '-pix_fmt',
        'yuv420p',
        '-c:a',
        'aac',
        '-b:a',
        '128k',
        // Без faststart браузер (и Mini App) ждёт полной загрузки перед стартом.
        '-movflags',
        '+faststart',
        outputPath,
      ]);

      const posterPng = await this.extractPoster(inputPath, probe);
      const video = await readFile(outputPath);
      return { video, posterPng };
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  // Кадр на первой секунде: на нулевой у многих роликов ещё чёрный экран.
  // У совсем коротких видео берём самое начало.
  private async extractPoster(
    inputPath: string,
    probe: VideoProbe,
  ): Promise<Buffer> {
    const at = probe.durationSec > 1.5 ? '1' : '0';
    const { stdout } = await run('ffmpeg', [
      '-ss',
      at,
      '-i',
      inputPath,
      '-frames:v',
      '1',
      '-f',
      'image2',
      '-vcodec',
      'png',
      'pipe:1',
    ]);
    if (stdout.length === 0) {
      throw new Error('ffmpeg не отдал кадр для обложки');
    }
    return stdout;
  }
}
