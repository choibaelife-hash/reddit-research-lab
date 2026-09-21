# Railway 배포용 Next.js 이미지.

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

COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
# 스키마 적용(npm run schema)에 필요하다. standalone 산출물에는 안 들어간다.
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/schema.sql /app/schema-saas.sql ./

EXPOSE 3000
ENV PORT=3000 HOSTNAME=0.0.0.0
CMD ["node", "server.js"]
