# Railway 배포용. Vercel에서 옮기는 이유는 06-DEPLOY / 02-INFRA 4장 참고 —
# 영상분석 2단계가 사용자 1명당 약 10분이라 서버리스 300초 한도를 넘는다.
#
# GPU는 이 이미지에 없다. Whisper·Qwen3-VL은 RunPod에 따로 두고 HTTP로 부른다.
# 여기 필요한 건 yt-dlp(다운로드)와 ffmpeg(오디오·프레임 추출)뿐이다.

FROM node:24-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:24-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:24-slim AS runner
WORKDIR /app
ENV NODE_ENV=production

# yt-dlp는 유튜브가 바뀔 때마다 갱신되므로 pip로 최신을 받는다.
# ffmpeg는 --download-sections 구간 자르기와 프레임 추출에 필수다.
RUN apt-get update && apt-get install -y --no-install-recommends \
      ffmpeg python3 python3-pip ca-certificates curl \
 && pip3 install --break-system-packages --no-cache-dir yt-dlp \
 && apt-get clean && rm -rf /var/lib/apt/lists/*

# lib/video/analyze.ts가 이 경로들을 환경변수로 읽는다. 맥의 venv 경로 대신 시스템 경로를 쓴다.
ENV YTDLP_BIN=/usr/local/bin/yt-dlp
ENV FFMPEG_BIN=/usr/bin/ffmpeg

COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
# 스키마 적용(npm run schema)에 필요하다. standalone 산출물에는 안 들어간다.
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/schema.sql /app/schema-video.sql ./

EXPOSE 3000
ENV PORT=3000 HOSTNAME=0.0.0.0
CMD ["node", "server.js"]
