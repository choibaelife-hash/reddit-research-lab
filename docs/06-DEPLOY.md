# 배포 체크리스트

**아직 배포하지 않았다.** 배포할 때 이 문서를 열고 순서대로 확인할 것.
크론은 배포돼야 실제로 도는 기능이라 **배포와 묶어서** 진행하기로 했다 (2026-08-26 결정).

> **배포처 (2026-08-27 갱신)**
> 1단계(레딧·유튜브 수집)는 **Vercel**에서 그대로 간다.
> 2단계 분석을 붙일 때 **Railway**로 옮긴다. GPU는 빌리지 않는다 —
> 자막·이미지 판독을 OpenAI API로 부르므로 컨테이너는 CPU만 쓴다 (2026-08-28 변경).
> 절차는 [06-DEPLOY-RAILWAY](06-DEPLOY-RAILWAY.md), 뒤집힌 경위는 그 문서 2장 참고.
> 옮길 때 이 문서의 `vercel env` 명령과 `vercel.json` 크론은 Railway 방식으로 재작성해야 한다.

---

## 1. 배포 전 확인

- [x] `npx tsc --noEmit` 통과 (2026-08-26)
- [x] `npm run build` 통과 (2026-08-26 확인)
- [ ] `.env.local`이 `.gitignore`에 있는지 재확인
- [ ] 기존 `museofseoul-dashboard`가 같은 DB를 쓰는데 **배포되어 있지 않은지** 확인
      (2026-08-26 시점: 배포·git 연결 모두 없음 → 크론 충돌 없음)

## 2. 환경변수 — Vercel에 등록할 것

| 키 | 용도 | 없으면 |
|---|---|---|
| `DATABASE_URL` | Postgres | 전부 죽음 |
| `CRON_SECRET` | 크론 라우트 인증 | 401 |
| `OPENAI_API_KEY` | 분류·카드·댓글 엔티티 | LLM 단계 전부 실패 |
| `APIFY_API_TOKEN` | **이제 안 씀** | 등록 불필요 (인스타 코드 삭제됨) |
| **`BOARD_PASSWORD`** | **`/board` 접근 비밀번호** | **잠금이 꺼져 URL 아는 사람 누구나 봄** |
| **`YOUTUBE_API_KEY`** | 영상분석 탭 — 유튜브 검색·조회수 | 영상 크론이 500. 다른 기능은 정상 |
| `N8N_INGEST_SECRET` | 레거시 | 등록 불필요 |

```bash
vercel env add DATABASE_URL production
vercel env add CRON_SECRET production
vercel env add OPENAI_API_KEY production
vercel env add BOARD_PASSWORD production   # ← 빼먹으면 공개됨
vercel env add YOUTUBE_API_KEY production  # ← 영상분석 탭
```

## 3. 크론 — tick 상태 머신 ✅ 구현 완료 (`/api/cron/tick`)

크론은 **실행 순서를 보장하지 않는다.** 그런데 우리는 `수집 → 분류 → 댓글 → 카드` 순서가 필요하고,
댓글은 회당 5건이 한계라 여러 번 돌아야 한다.

→ **크론 하나가 "다음 할 일"을 스스로 판단하는 방식**으로 간다.

### `/api/cron/tick` 이 매 실행마다 하는 판단

```
1. 이번 주 레딧 수집 안 됐나?          → collectReddit()      후 종료
2. 분류 안 된 글 있나?                 → classifyPosts()      후 종료
3. 댓글 없는 상위 글 있나?             → collectComments(5)   후 종료
4. 댓글 엔티티 추출 안 된 글 있나?      → extractCommentEntities() 후 종료
5. 카드 없는 상위 글 있나?             → buildCards()         후 종료
6. 다 됐으면                          → 아무것도 안 하고 즉시 종료
```

**이 방식의 장점**

- 앞 단계가 안 끝나면 다음으로 안 넘어가므로 **순서가 저절로 보장**된다
- **크론이 1개만 필요** → Vercel 요금제의 크론 개수 제한을 안 탄다
- 한 단계가 실패해도 **다음 tick에서 자연히 재시도**된다
- 각 파이프라인이 이미 "아직 처리 안 한 것"만 고르므로 **중복 실행해도 API 재과금 없음**

### vercel.ts (권장) 또는 vercel.json

```ts
// vercel.ts
import type { VercelConfig } from '@vercel/config/v1';

export const config: VercelConfig = {
  crons: [
    // 일요일 20:00 UTC(월 05:00 KST)부터 10분 간격으로 tick
    { path: '/api/cron/tick', schedule: '*/10 20-23 * * 0' },
    { path: '/api/cron/tick', schedule: '*/10 0-2 * * 1' },
  ],
};
```

- [x] `vercel.json`을 tick 4회로 교체 완료 (UTC 일 20~23시 = **KST 월 05~08시**)
- [ ] 요금제별 크론 제한 확인 — **Hobby는 하루 1회 제한**이 있을 수 있다.
      그 경우 tick 한 번이 최대한 진행하도록 이미 설계돼 있으니 하루 1회로도 며칠에 걸쳐 채워진다
- [x] 한 번에 여러 단계를 이어서 처리 + **단계별 시간 예산**으로 300초 한도 보호 (실측 235초·177초)

### 🔴 무한 루프 — 5번 겪었다. 조건을 건드리면 반드시 감사할 것

`nextStep`(할 일 있나)이 세는 대상과 처리기가 잡는 대상이 어긋나면 영원히 돈다.
**카드 단계는 `gpt-4.1`이라 반복마다 82원씩 나간다.**

구조적 차단은 걸어 뒀다 — **한 단계가 0건을 처리하면 즉시 `stalled`로 멈추고 원인 단계를 보고한다.**
하지만 조건을 수정할 때는 판단 SQL과 처리 SQL을 나란히 세어 **같은 수가 나오는지 먼저 확인**할 것.

### 실행 상태 확인

```bash
# 지금 할 일이 뭔지만 조회 (실행 안 함)
curl -H "Authorization: Bearer $CRON_SECRET" https://<도메인>/api/cron/tick?peek=1
# → {"next":"comments"}  또는  {"next":"idle"}
```

## 4. 함수 시간 한도

| 라우트 | `maxDuration` | 실측 소요 |
|---|---|---|
| `collect-reddit` | 300 | 약 1분 (5개 × 12초) |
| `collect-comments` | 300 | **글당 약 1분** → 회당 4~5건이 한계 |
| `classify` | 300 | 100건에 약 2분 |
| `build-cards` | 300 | 12장에 약 1분 |
| `comment-entities` | 300 | 배치당 수 초 |

- [x] `tick`에 `export const maxDuration = 300` 적용
- [x] **단계별 시간 예산**으로 한도 초과 차단 — 실측 235초·211초·4.7초

## 5. 배포 후 검증

- [x] `/api/cron/tick`을 수동 호출해 **`idle` 도달까지 확인** (2026-08-26)
- [ ] 로그에서 429(레딧 레이트리밋) 백오프가 정상 동작하는지
- [ ] `source_status` 테이블이 갱신되는지
- [ ] **다음 주 일요일에 자동으로 돌았는지** — 이게 진짜 검증

```bash
# 수동 호출
curl -H "Authorization: Bearer $CRON_SECRET" https://<도메인>/api/cron/tick
```

---

## 놓치기 쉬운 것 — 반드시 확인

### 🔴 다른 프로젝트가 같은 DB를 쓴다

`clients` · `surveys` · `tasks` · `submissions` 테이블은 **다른 프로젝트 소유**다.
마이그레이션 스크립트가 이 테이블을 건드리지 않는지 확인할 것.

### 🔴 레딧 레이트리밋은 IP 기준일 가능성

로컬에서 실측한 429 패턴이 Vercel 서버리스(공유 IP)에서 **더 심할 수 있다.**
배포 후 첫 수집에서 실패율을 반드시 확인하고, 필요하면 `GAP_MS`를 늘릴 것.

### 🔴 `BOARD_PASSWORD`를 반드시 등록할 것

없으면 **잠금이 자동으로 꺼진다**(로컬 개발 편의용 설계). 배포 시 빼먹으면 `/board`가 그대로 공개된다.
Next.js 16이라 미들웨어 파일은 `proxy.ts`다(`middleware.ts`는 deprecated).

### ✅ 확정·메모 DB 저장 — 해결됨 (2026-08-26)

`/board`가 Server Action으로 `idea_cards`에 직접 쓴다. `localStorage` 의존 제거됨.
`/board/export`에서 마크다운 파일 다운로드도 동작한다.

### 🟡 `Self` RSS 피드가 2026-05 이후 멈춤

배포 전에 URL 확인. 죽은 피드면 `collection_rules`에서 `enabled = false`.

### 🟡 인스타그램 테이블은 남아 있다

코드는 삭제했지만 `instagram_*` 4개 테이블은 보존했다(비파괴).
배포에 영향은 없지만, 나중에 정리할지 결정할 것.

---

## 배포 순서 (결정됨 2026-08-26)

1. ~~점수 재설계~~ ✅
2. ~~Next.js 대시보드~~ ✅ `/board`
3. **크론 + 배포** ← 이 문서. 지금 여기
