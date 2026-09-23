import sanitizeHtml from 'sanitize-html';

/**
 * Текст рассылки пишется в tiptap (HTML), а уходит в два формата:
 *  - Telegram (`parse_mode: 'HTML'`) понимает только инлайн-теги — b/i/u/s/a/code/
 *    blockquote. Абзацев, заголовков и списков у него нет, их приходится разворачивать
 *    в переносы строк и маркеры «• » / «1. ». Любой лишний тег — 400 «can't parse
 *    entities» на всю отправку, поэтому allowlist строгий.
 *  - push и лента — plain text.
 *
 * Сначала sanitize-html приводит ввод к известному набору тегов (заодно синонимы
 * из вставки — b/i/strike — и экранирование текста), потом простой проход по
 * токенам собирает результат. После sanitize-html разметка гарантированно
 * корректная, поэтому регэксп-токенайзера тут достаточно.
 */

const INLINE_TAGS = ['b', 'i', 'u', 's', 'code'];

const CLEAN: sanitizeHtml.IOptions = {
  allowedTags: [
    ...INLINE_TAGS,
    'a',
    'p',
    'br',
    'h2',
    'h3',
    'ul',
    'ol',
    'li',
    'blockquote',
  ],
  allowedAttributes: { a: ['href'] },
  allowedSchemes: ['http', 'https', 'tg', 'mailto'],
  transformTags: {
    strong: 'b',
    em: 'i',
    ins: 'u',
    strike: 's',
    del: 's',
    h1: 'h2',
    h4: 'h3',
    h5: 'h3',
    h6: 'h3',
  },
  nonTextTags: [
    'script',
    'style',
    'textarea',
    'noscript',
    'template',
    'iframe',
    'svg',
  ],
  disallowedTagsMode: 'discard',
};

const TOKEN = /<(\/?)([a-z0-9]+)((?:\s[^>]*)?)>|[^<]+/g;

type Mode = 'telegram' | 'plain';

function render(html: string, mode: Mode): string {
  const clean = sanitizeHtml(html, CLEAN);
  const lists: { ordered: boolean; n: number }[] = [];
  let inItem = 0;
  let out = '';

  const newline = () => {
    if (out && !out.endsWith('\n')) out += '\n';
  };
  const trimEnd = () => {
    out = out.replace(/\n+$/, '');
  };

  for (const match of clean.matchAll(TOKEN)) {
    const [raw, closing, tag, attrs] = match;
    if (!tag) {
      out += raw;
      continue;
    }

    switch (tag) {
      case 'p':
        // Абзац внутри пункта списка — это просто текст пункта: иначе между
        // пунктами появились бы пустые строки.
        if (closing && !inItem) out += '\n\n';
        break;
      case 'br':
        out += '\n';
        break;
      case 'h2':
      case 'h3':
        if (mode === 'telegram') out += closing ? '</b>' : '<b>';
        if (closing) out += '\n\n';
        break;
      case 'ul':
      case 'ol':
        if (closing) {
          lists.pop();
          newline();
          if (lists.length === 0) out += '\n';
        } else {
          newline();
          lists.push({ ordered: tag === 'ol', n: 0 });
        }
        break;
      case 'li': {
        if (closing) {
          inItem--;
          newline();
          break;
        }
        inItem++;
        newline();
        const list = lists[lists.length - 1];
        const marker = list?.ordered ? `${++list.n}. ` : '• ';
        out += '   '.repeat(Math.max(lists.length - 1, 0)) + marker;
        break;
      }
      case 'blockquote':
        if (closing) {
          trimEnd();
          if (mode === 'telegram') out += '</blockquote>';
          out += '\n\n';
        } else if (mode === 'telegram') {
          out += '<blockquote>';
        }
        break;
      case 'a':
        if (mode === 'telegram') out += closing ? '</a>' : `<a${attrs}>`;
        break;
      default:
        // INLINE_TAGS
        if (mode === 'telegram') out += raw;
    }
  }

  const text = out.replace(/\n{3,}/g, '\n\n').trim();
  return mode === 'plain' ? decodeEntities(text) : text;
}

// sanitize-html экранирует ровно эти четыре — их и раскрываем обратно.
function decodeEntities(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&');
}

/**
 * То, что сохраняем в Broadcast.body: ввод, приведённый к allowlist'у. Документ
 * без текста (`<p></p>` пустого редактора) → `''`, чтобы пустой перевод не
 * перебил фолбэк на RU.
 */
export const sanitizeBroadcastHtml = (html: string): string => {
  const clean = sanitizeHtml(html, CLEAN).trim();
  return render(clean, 'plain') ? clean : '';
};

/** HTML из tiptap → HTML-подмножество Bot API. */
export const toTelegramHtml = (html: string): string =>
  render(html, 'telegram');

/** HTML из tiptap → plain text с переносами (push, лента). */
export const toPlainText = (html: string): string => render(html, 'plain');

/** Экранирование обычного текста (заголовок) для parse_mode HTML. */
export const escapeTelegramHtml = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
