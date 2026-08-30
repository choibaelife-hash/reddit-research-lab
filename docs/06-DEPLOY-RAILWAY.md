# Railway 배포 — 절차와 환경변수

작성 2026-08-28 · 갱신 2026-08-30 · 상태: **배포 완료** — `reddit-research-lab-production.up.railway.app`
2단계를 1편 돌려 `failed: []` 확인(yt-dlp가 클라우드 IP에서 막히지 않았다). 표본 1편이라 15편 배치는 아직 모른다.

> 🔴 **환경변수가 "분명히 넣었는데 앱은 미설정이라고 하는" 증상 — 이름 앞의 공백을 의심할 것.**
> ` CRON_SECRET`과 `CRON_SECRET`은 다른 변수인데 Railway 화면에서는 구분되지 않는다.
> 2026-08-30 배포에서 이것 때문에 오후 내내 막혔다. Console에서 이름을 대괄호로 감싸 확인한다:
> ```
> env | cut -d= -f1 | grep -iE "cron|openai|youtube|board" | sed 's/^/[/; s/$/]/'
> ```
> 값 칸만 붙여넣고 **이름은 손으로 타이핑**하면 재발하지 않는다.
관련: [02-INFRA 4장](saas/02-INFRA.md) · [03-VIDEO 7장](saas/03-VIDEO.md) · 기존 [06-DEPLOY](06-DEPLOY.md)

> **왜 옮기나**
> 영상분석 2단계가 사용자 1명당 14편 × 약 99초 ≈ **23분**이다.
> Vercel 함수 한도 `maxDuration = 300`을 넘어 **서버리스에서는 물리적으로 못 돈다.**

---

## 0. Vercel과 달라지는 지점 — 코드 점검 결과 (2026-08-28)

옮기기 전에 코드를 훑어 Vercel에만 기대던 부분을 찾아 전부 정리했다.

### 🔴 고친 것 — 그냥 옮겼으면 보안 구멍이 됐다

`tick` 라우트가 **`x-vercel-cron` 헤더가 있으면 토큰 없이 통과**시키고 있었다.
Vercel에서는 그 헤더를 Vercel이 통제해줬지만 **Railway에는 막아줄 주체가 없다.**
게다가 `proxy.ts`가 `/api/`를 그냥 통과시켜(비밀번호 잠금 대상이 아님) 이 검사가 유일한 방어선이었다.

```bash
# 그대로 옮겼다면 아무나 이걸 날릴 수 있었다
curl -H "x-vercel-cron: 1" https://<주소>/api/cron/tick
→ 레딧 파이프라인 전체 실행 · LLM 과금 · 유튜브 할당량 소모
```

같이 발견한 것: **`CRON_SECRET`을 빼먹으면 `Bearer undefined`가 통과**했다.
환경변수 하나 안 넣으면 잠금이 조용히 풀리는 구조였다(`BOARD_PASSWORD`와 같은 함정).

**→ `lib/cron-auth.ts`의 `denyCron()` 하나로 10개 라우트를 통일했다.**
비밀이 없으면 503, 토큰이 틀리면 401. 헤더 예외는 없앴다.

| 시험 | 결과 |
|---|---|
| `x-vercel-cron: 1` 위조 | **401** ✅ |
| 토큰 없음 | 401 ✅ |
| 틀린 토큰 | 401 ✅ |
| `Bearer undefined` | **401** ✅ |
| 올바른 토큰 | 200 ✅ |

### 🔴 크론 이중 실행 — Vercel을 반드시 꺼야 한다

`vercel.json`의 크론 5개를 지웠다. **양쪽이 살아 있으면 같은 주에 두 번 돌아
비용이 두 배가 되고 유튜브 할당량도 두 번 탄다.**

### 🟡 정리한 것

| | 조치 |
|---|---|
| `maxDuration = 300` 9곳 | **전부 제거.** Vercel 전용이라 Railway는 무시한다. 남겨두면 "왜 300초?"라고 헷갈린다 — 애초에 그 한도를 못 지켜서 옮기는 것이다 |
| DB 커넥션 풀 | 상주 프로세스라 커넥션을 계속 붙잡는다. `max`·`idleTimeout`을 명시하고, **유휴 커넥션 오류로 프로세스가 죽지 않도록** 핸들러를 달았다 |
| 헬스체크 | `proxy.ts`가 `/`를 `/login`으로 307 리다이렉트한다. `healthcheckPath`를 `/login`으로 지정했다 |

### ✅ 손댈 필요 없던 것

`@vercel/*` 패키지 없음 · `VERCEL_*` 환경변수 안 씀 · `next/image` 미사용(sharp 불필요) ·
임시파일이 `tmpdir()`이라 양쪽 다 동작 · 미들웨어가 표준 Web Crypto라 Node 24에서 동작.

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
| ~~RunPod GPU 엔드포인트~~ | ✅ **불필요해졌다** — 2026-08-28에 GPU를 빌리지 않기로 했다(아래 2장) |

---

## 2. 서비스 구성 — 큐 워커는 아직 만들지 않는다

[02-INFRA 5장](saas/02-INFRA.md)은 큐 워커(`SELECT ... SKIP LOCKED`)를 그렸지만
**지금은 사용자가 1명이라 집어갈 잡을 두고 경합할 일이 없다.** 과설계다.

```
Railway (CPU만)
 ├ web   : node server.js          ← Next.js. 화면 + 크론 엔드포인트
 └ cron  : node scripts/cron.mjs X ← 일정마다 실행되고 끝나는 컨테이너
OpenAI API
 └ 자막(전사) · 썸네일/장면 판독 · 분류 · 종합
```

**GPU를 빌리지 않는다(2026-08-28 결정).** 맥에서는 mlx로 모델을 직접 돌렸지만,
mlx는 애플 실리콘 전용이라 리눅스 컨테이너에서 아예 실행되지 않는다.
CPU에 직접 올리려면 라이브러리를 갈아타고 모델 4.4GB를 이미지에 넣어야 한다.
대신 **OpenAI에 물어본다** — 컨테이너에는 모델이 없고, Dockerfile도 그대로다.

코드는 원래 OpenAI 호환 형식으로 부르고 있어서 인증 헤더 한 줄만 추가했다.
Railway 컨테이너가 CPU로 하는 일은 `yt-dlp`(다운로드)와 `ffmpeg`(오디오·프레임 추출)뿐이다.

실측으로 확인함(2026-08-28, 예전 mlx 결과와 같은 영상 비교):

| | 예전 (mlx, 맥 GPU) | 새 (OpenAI) |
|---|---|---|
| 썸네일 판독 | 글자를 전부 `unknown`으로 포기 | `STELLA`, `potentia SHAMPOO & TREATMENT`를 읽음 · 6.8초 |
| 자막 | `duck armpits …` | `dark armpits …` (정확) · 1.1초 |

JSON 키 구성이 같아 화면·종합 단계는 손대지 않았다.

크론이 HTTP로 web을 부른다. **Railway는 서버리스가 아니라 요청이 20분 걸려도 끊기지 않는다.**
엔드포인트가 멱등이라(이미 분석한 영상은 건너뜀) 중간에 끊겨도 다시 돌리면 이어진다.

---

## 3. 크론 일정

Vercel의 `vercel.json` crons는 Railway가 읽지 않는다. Railway는 **서비스마다 별도 cron**으로 등록한다.

일정과 실행 명령은 저장소에 파일로 넣어 뒀다(config as code). 대시보드에서 손으로 입력하면
어디에 뭐가 적혀 있는지 흩어져 다음 사람이 못 찾는다.

| 서비스 | 설정 파일 |
|---|---|
| `cron-reddit` | `railway.cron-reddit.json` |
| `cron-video` | `railway.cron-video.json` |
| `cron-analyze` | `railway.cron-analyze.json` |

**사람이 대시보드에서 할 일은 두 가지뿐이다.** 서비스를 만들고, Settings의 *Config as code* 경로를
위 파일로 지정한다. 나머지(실행 명령·일정·재시작 정책)는 파일이 정한다.

`restartPolicyType`이 `NEVER`인 이유: 크론은 일을 마치면 컨테이너가 죽는 게 정상이다.
`ON_FAILURE`로 두면 끝날 때마다 다시 살아나 무한히 돈다 — LLM 비용과 유튜브 할당량이 계속 샌다.

| 작업 | 명령 | 일정(UTC) | 한국 시간 | 비고 |
|---|---|---|---|---|
| 레딧 파이프라인 | `node scripts/cron.mjs reddit` | `0 9 * * 1` | 월 18:00 | **idle까지 한 번에 돈다.** Vercel에서 300초 때문에 4번 쪼개던 걸 합쳤다 |
| 영상 1단계 | `node scripts/cron.mjs video` | `0 11 * * 1` | 월 20:00 | 레딧이 끝난 뒤 |
| 영상 2단계 | `node scripts/cron.mjs analyze` | `0 12 * * 1` | 월 21:00 | 1단계 뒤. 약 23분 소요 |

**왜 월요일 18:00(KST)인가 (2026-08-30 결정)**

레딧 수집은 `top/.rss?t=week`를 쓴다(`lib/collectors/reddit.ts:31`). `t=week`는 **달력 주가 아니라
요청 시점에서 거슬러 7일**인 롤링 윈도우다. 그래서 "레딧 주차에 맞춘다"는 개념이 없고,
대신 두 가지가 중요하다.

1. **매주 같은 시각**에 불러야 7일 창이 어긋나지 않는다 — 시각이 흔들리면 어떤 글은 두 번 잡히고 어떤 글은 빠진다.
2. **글이 표를 다 받은 뒤**에 불러야 한다. `top` 순위를 화제성 점수로 쓰기 때문에, 방금 올라온 글은 순위가 낮게 잡힌다.

기준은 **미국(하와이 제외)에서 일요일이 완전히 끝나는 시각**이다. 가장 서쪽인 알래스카가 기준이고,
서머타임 때문에 여름·겨울이 1시간 다르므로 **겨울(AKST = UTC-9)** 기준으로 잡아야 1년 내내 안전하다.

```
알래스카 월요일 00:00 AKST  =  월요일 09:00 UTC  =  월요일 18:00 KST
```

**화면에도 같은 값이 적혀 있다.** `lib/workspace.ts`의 `COLLECT_UTC_HOUR`·`COLLECT_LABEL`이
마이페이지의 "수집 주기 / 다음 수집"을 만든다. **일정을 바꾸면 두 곳을 함께 고칠 것** — 어긋나면 화면이 거짓말을 한다.
마지막 수집이 8일을 넘기면 마이페이지가 "자동 수집이 등록되지 않았거나 실패하고 있을 수 있습니다"를 띄운다.

곁들여 얻는 것 두 가지:
- **유튜브 할당량**은 태평양 자정(07~08:00 UTC)에 리셋된다. 09:00 UTC는 그 직후라 하루치를 온전히 쓴다.
- `mondayOf()`는 **UTC 기준으로 요일을 본다**. 한국 월요일 새벽 0~9시는 UTC로 아직 일요일이라
  주차가 지난 주로 잡히는 함정이 있는데, 이 시각은 그 구간을 피한다 — 코드를 고칠 필요가 없다.

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
| `VLM_URL` | `https://api.openai.com/v1/chat/completions` | localhost를 보다 실패 |
| `VLM_MODEL` | `gpt-4.1-mini` | mlx 모델명을 보내 400 |
| `WHISPER_URL` | `https://api.openai.com/v1/audio/transcriptions` | 로컬 CLI로 떨어짐 → 컨테이너에 없어 실패 |
| `WHISPER_MODEL` | `whisper-1` | mlx 모델명을 보내 400 |

> 위 네 개는 **모델 이름까지 환경변수**다. 더 싸거나 좋은 모델로 바꿀 때 코드를 고치지 않아도 된다.
> 인증은 `OPENAI_API_KEY` 하나를 같이 쓴다 — 키를 새로 만들 필요가 없다.
| `YTDLP_BIN` · `FFMPEG_BIN` | Dockerfile이 이미 설정 | — |

**cron 서비스** — 위 전부 + `APP_URL`(web 서비스의 공개 주소)

---

## 5. 배포 후 확인 순서

```bash
# 1. 스키마 적용 (web 서비스 셸에서 1회)
node scripts/apply-schema.mjs

# 2. 1단계만 먼저 — 영상을 받지 않으므로 빠르다
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

- [x] `vercel.json`의 crons 제거 (2026-08-28 완료)
- [ ] **Vercel 프로젝트 중지 또는 삭제** ← 이걸 안 하면 크론이 사라져도 웹은 계속 떠 있어
      같은 DB를 두 곳이 바라본다. 화면만 뜨는 건 무해하지만 혼동을 부른다
- [ ] `03-VIDEO.md` 7장의 "클라우드 전망" 칸에 **실측값** 기록 (지금은 비워 뒀다)
- [ ] `PG_POOL_MAX`가 DB 플랜의 동시 접속 상한을 넘지 않는지 확인 (기본 10)
