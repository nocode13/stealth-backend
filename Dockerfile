FROM node:22-slim AS base
# ffmpeg нужен в runtime: VideoService зовёт ffmpeg/ffprobe как внешние бинарники
# (транскод видео в mp4 и кадр для обложки), npm-обёртки для этого не используются.
# libjemalloc2 — аллокатор вместо glibc malloc (подключается в runtime через LD_PRELOAD):
# на glibc нативная память sharp/libvips фрагментируется по per-thread аренам и не
# возвращается ОС, RSS после первой же загрузки фото залипал на ~700 МБ. Симлинк
# убирает архитектуру из пути (x86_64 на Railway, aarch64 при локальной сборке на Mac).
RUN apt-get update -y && apt-get install -y openssl ffmpeg libjemalloc2 && rm -rf /var/lib/apt/lists/* \
  && ln -s /usr/lib/$(uname -m)-linux-gnu/libjemalloc.so.2 /usr/local/lib/libjemalloc.so.2
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm build

FROM base AS runtime
ENV NODE_ENV=production
ENV LD_PRELOAD=/usr/local/lib/libjemalloc.so.2
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
COPY prisma ./prisma

EXPOSE 3000
# Без pnpm-обёртки: она висела бы родительским процессом (~50 МБ) на всё время жизни
# контейнера. exec — чтобы SIGTERM от Railway получал сам node, а не sh.
# Дублируется в railway.json (startCommand перекрывает CMD) — править оба.
CMD ["sh", "-c", "./node_modules/.bin/prisma migrate deploy && exec node dist/main"]
