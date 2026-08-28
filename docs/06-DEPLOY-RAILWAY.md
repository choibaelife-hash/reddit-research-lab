# Railway 배포 — 절차와 환경변수

작성 2026-08-28 · 상태: **파일 준비 완료, 배포 미실행**
관련: [02-INFRA 4장](saas/02-INFRA.md) · [03-VIDEO 7장](saas/03-VIDEO.md) · 기존 [06-DEPLOY](06-DEPLOY.md)

> **왜 옮기나**
> 영상분석 2단계가 사용자 1명당 14편 × 약 99초 ≈ **23분**이다.
> Vercel 함수 한도 `maxDuration = 300`을 넘어 **서버리스에서는 물리적으로 못 돈다.**

---

## 1. 준비된 것 / 사람이 해야 하는 것

| | 상태 |
|---|---|
| `Dockerfile` (node 24 + ffmpeg + yt-dlp) | ✅ 작성됨 · ⚠️ **로컬 검증 불가**(맥에 도커 미설치). Railway 첫 빌드에서 확인된다 |
| `railway.json` | ✅ |
| `.dockerignore` | ✅ |
| `next.config.js`의 `output: "standalone"` | ✅ 빌드 확인함 |
| `scripts/cron.mjs` (크론 진입점) | ✅ |
| Railway 계정·프로젝트 생성 | ❌ **사람만 할 수 있다** |
| 환경변수 등록 | ❌ 사람 |
| RunPod GPU 엔드포인트 | ❌ 사람 |

---

## 2. 서비스 구성 — 큐 워커는 아직 만들지 않는다

[02-INFRA 5장](saas/02-INFRA.md)은 큐 워커(`SELECT ... SKIP LOCKED`)를 그렸지만
**지금은 사용자가 1명이라 집어갈 잡을 두고 경합할 일이 없다.** 과설계다.

```
Railway
 ├ web   : node server.js          ← Next.js. 화면 + 크론 엔드포인트
 └ cron  : node scripts/cron.mjs X ← 일정마다 실행되고 끝나는 컨테이너
RunPod
 └ GPU   : Whisper + Qwen3-VL (OpenAI 호환)
```

크론이 HTTP로 web을 부른다. **Railway는 서버리스가 아니라 요청이 20분 걸려도 끊기지 않는다.**
엔드포인트가 멱등이라(이미 분석한 영상은 건너뜀) 중간에 끊겨도 다시 돌리면 이어진다.

---

## 3. 크론 일정

Vercel의 `vercel.json` crons는 Railway가 읽지 않는다. Railway 대시보드에서 서비스별 cron으로 등록한다.

| 작업 | 명령 | 일정(UTC) | 비고 |
|---|---|---|---|
| 레딧 파이프라인 | `node scripts/cron.mjs reddit` | `0 11 * * 0` | **idle까지 한 번에 돈다.** Vercel에서 300초 때문에 4번 쪼개던 걸 합쳤다 |
| 영상 1단계 | `node scripts/cron.mjs video` | `0 16 * * 0` | 레딧이 끝난 뒤 |
| 영상 2단계 | `node scripts/cron.mjs analyze` | `0 17 * * 0` | 1단계 뒤. 약 23분 소요 |

> ⚠️ **할당량 경계에 주의.** 유튜브 할당량은 태평양시 자정(한국 오후 4~5시)에 리셋된다
> ([03-VIDEO 4장](saas/03-VIDEO.md)). 나중에 사용자별 요일 분산을 넣을 때 이 경계를 기준으로 나눈다.

---

## 4. 환경변수

**web 서비스**

| 변수 | 값 | 없으면 |
|---|---|---|
| `DATABASE_URL` | Postgres 연결 문자열 | 전부 실패 |
| `OPENAI_API_KEY` | 레딧 분류 · 검색어 재구성 · 종합 | 해당 단계 실패 |
| `YOUTUBE_API_KEY` | 영상 1단계 | 영상 수집 실패 |
| `CRON_SECRET` | 크론 인증 | 401 |
| `BOARD_PASSWORD` | 화면 잠금 | 🔴 **잠금이 자동으로 꺼져 `/board`가 공개된다** |
| `VLM_URL` | RunPod Qwen3-VL 주소 (`https://…/v1/chat/completions`) | localhost를 보다 실패 |
| `WHISPER_URL` | RunPod Whisper 주소 (`https://…/v1/audio/transcriptions`) | 로컬 CLI로 떨어짐 → 컨테이너에 없어 실패 |
| `YTDLP_BIN` · `FFMPEG_BIN` | Dockerfile이 이미 설정 | — |

**cron 서비스** — 위 전부 + `APP_URL`(web 서비스의 공개 주소)

---

## 5. 배포 후 확인 순서

```bash
# 1. 스키마 적용 (web 서비스 셸에서 1회)
node scripts/apply-schema.mjs

# 2. 1단계만 먼저 — GPU 없이 돈다
curl -H "Authorization: Bearer $CRON_SECRET" https://<web>/api/cron/video

# 3. 2단계를 1편만 — 여기서 yt-dlp가 막히는지 드러난다
curl -H "Authorization: Bearer $CRON_SECRET" "https://<web>/api/cron/video-analyze?limit=1"
```

### 🔴 3번이 이번 배포의 진짜 시험이다

유튜브는 **클라우드 IP의 다운로드를 가정용 IP보다 공격적으로 차단**한다.
맥에서 되던 것이 Railway에서 막힐 수 있다.

응답의 `failed` 배열을 반드시 확인할 것:

```
failed: []                      → 정상
failed: ["download: ..."]       → ⚠️ IP 차단. 썸네일(계층 0)은 살아 있다
failed: ["thumb: ..."]          → 유튜브 API 자체 문제
```

**막혀도 제품이 죽지는 않는다** — 폴백 3계층([03-VIDEO 7장](saas/03-VIDEO.md))에 따라
썸네일 분석은 다운로드가 필요 없어 그대로 나온다. 자막·첫15초만 빈다.

대응 순서: ① 요청 간격 늘리기 → ② 그래도 막히면 레지던셜 프록시 검토.

---

## 6. 옮긴 뒤 정리할 것

- [ ] `vercel.json`의 crons 제거 (양쪽에서 이중 실행 방지)
- [ ] Vercel 프로젝트 중지 또는 삭제
- [ ] `03-VIDEO.md` 7장의 "클라우드 전망" 칸에 **실측값** 기록 (지금은 비워 뒀다)
