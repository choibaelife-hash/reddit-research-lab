# 영상 조사 수동 승인 — 설계

2026-09-09. 배경: 크론 인증 버그(cron/production 두 서비스의 `CRON_SECRET` 불일치)를 고치는 과정에서,
"레딧이 끝나면 유튜브 조사까지 사람 확인 없이 전부 자동으로 도는" 지금 구조를 바꾸기로 함.
앞으로는 **키워드까지만 자동으로 뽑고, 실제 유튜브 검색·다운로드·분석은 사람이 버튼을 눌러야 시작**한다.

## 왜

- 유튜브 조사는 한 번 돌면 유튜브 할당량 + OpenAI 비용(2단계 다운로드·분석)이 실제로 나간다.
- 레딧에서 뽑힌 키워드 3개가 항상 조사할 가치가 있는 건 아니다 — 사람이 먼저 보고 걸러야 한다.
- 이미 `runs` 테이블에 상태 추적 인프라가 있어 추가 스키마 없이 구현 가능하다.

## 결정된 사항 (브레인스토밍에서 확정)

1. **정식 동작으로 계속** — 이번 한 번만이 아니라 앞으로 매주 이 방식으로 간다.
2. **새 탭 안 만든다** — `/board`에 이미 "유튜브" 탭(`components/video/VideoTab.tsx`)이 있다. 거기에 상태 뱃지 + [시작] 버튼만 얹는다.
3. **놓친 주는 그냥 스킵** — 이번 주 키워드에 [시작]을 안 누른 채 다음 주 레딧이 끝나면, 화면은 다음 주 키워드로 넘어가고 이전 주는 영영 조사 안 함. 되돌리기 없음.
4. **버튼은 fire-and-forget** — 누르면 즉시 "시작됨" 응답, 화면 벗어나도 백그라운드에서 계속 진행. 완료 여부는 새로고침해서 확인.

## 기존 코드 확인하며 바뀐 부분 (초안 대비 정정)

- `video_keywords`에 이미 `run_id` 컬럼이 있다(`schema-saas.sql`, `runs(id)` 참조, `on delete set null`). "스키마 변경 없음"은 그대로 유효 — 이 컬럼을 그대로 쓴다.
- `lib/video/data.ts`의 `getWeeks(workspaceId)`가 `video_keywords.run_id → runs.workspace_id`로 워크스페이스를 거른다:
  ```sql
  where ($1::uuid is null or r.workspace_id = $1::uuid)
  ```
  **문제**: propose 단계는 `runs`를 안 열므로(아래) 갓 제안된 키워드는 `run_id`가 `NULL`이다. 위 조건은 `r`이 NULL(=아직 태그 안 됨)이면 걸러버려서, 대기중인 주가 "영상 탭"에 아예 안 보인다. → `getWeeks`에 `or k.run_id is null` 조건을 추가해 태그 안 된(=대기중) 주도 보이게 고친다.
- `VideoTab.tsx`의 빈 상태 문구("이번 주 레딧 키워드 3개로 유튜브를 훑는 작업이 월요일 새벽에 돕니다")는 **자동 완료를 약속하는 지금 문구**라 바뀐 동작과 안 맞는다. "키워드는 자동으로 뽑히고, 조사는 버튼을 눌러야 시작됩니다" 톤으로 고친다.

## 스키마 변경 없음

기존 테이블만 재사용한다.

- `video_keywords` (week, keyword, rank, score, reason) — 키워드 저장은 지금과 동일.
- `runs` (workspace_id, week, kind, status, stats, error) — `kind='video'` 줄의 상태(running/done/failed 유무)로 진행 상태를 그대로 판단한다.
  - 이 주차에 `runs` 줄이 없음 → **대기중** (키워드만 있고 아직 안 누름)
  - `status='running'` → **진행중**
  - `status='done'` → **완료**
  - `status='failed'` → **실패** (재시도 가능하게 버튼 다시 노출)

## 코드 구조

`lib/video/run.ts`를 두 함수로 쪼갠다 (지금은 `runVideo()` 하나가 다 함):

- **`proposeKeywords({week, workspaceId, limit})`** — 키워드 픽업(`pickKeywords`) + 검색어 다듬기(`refineSearchQuery`) + 저장(`saveKeywords`)만. `runs` 기록 없음(가볍고 실패해도 크론이 다음 주기에 다시 시도하면 그만).
- **`searchVideos({week})`** — 이미 저장된 `video_keywords`를 읽어 유튜브 검색·아웃라이어 계산·저장만. `runs` 오픈/클로즈는 밖에서 감싼다(아래 오케스트레이터).

`app/api/cron/video-analyze/route.ts`의 분석·종합 로직을 `lib/video/analyze-run.ts`의 `runAnalysis({week, limit})`로 뽑아낸다 (route는 이 함수를 부르는 얇은 래퍼로 남긴다 — 수동 curl 디버깅 그대로 가능).

새 오케스트레이터 `lib/video/start.ts`의 **`startVideoInvestigation({week, workspaceId})`**:
```
openRun(ws, "video", week)
→ searchVideos(week)
→ runAnalysis(week)
→ tagRun(["video_keywords"])
→ closeRun("done", 합친 stats)
실패 시 closeRun("failed", ..., error)
```
버튼 클릭이 부르는 게 바로 이 함수다. 검색부터 분석·종합까지 하나의 `runs` 줄로 묶여서, 화면은 이 한 줄의 상태만 보면 된다.

## 엔드포인트/크론 변경

- 새 라우트 **`/api/cron/video-propose`** — `denyCron` 가드, `proposeKeywords()` 호출. `due()`가 레딧 끝난 뒤 이걸 부른다.
- `scripts/cron.mjs`의 `due()`: 지금 `video` + `video-analyze` 순차 호출을 **`video-propose` 호출 하나로 교체**. 자동 경로에서 검색·분석을 더 이상 부르지 않는다.
- `node scripts/cron.mjs video` / `analyze` 수동 명령어는 디버깅용으로 그대로 둔다 (기존 라우트 유지).

## `/board` "유튜브" 탭 (`VideoTab.tsx`) 변경

- `getWeeks()`를 고쳐 `run_id is null`(대기중)인 주도 목록에 나오게 한다.
- 빈 상태 문구를 "조사는 버튼으로 시작" 톤으로 수정.
- 키워드 카드 목록 위(또는 상단)에 이번 주 상태 뱃지(대기중/진행중/완료/실패)를 추가.
- **대기중 또는 실패**일 때만 [시작] 버튼 노출. 진행중/완료면 버튼 숨김.
- 완료 후 카드 내용(빈 구멍·썸네일 패턴·근거 영상 등)은 지금 컴포넌트 그대로 — 변경 없음.

## Server Action (`app/board/actions.ts`)

**`startVideoRun(week: string)`**:
1. 현재 `runs` 상태 조회 — `running`이면 거절("이미 진행중"), `done`이면 거절("이미 완료").
2. 아니면 `startVideoInvestigation({week, workspaceId})`를 **await 하지 않고** 호출 후 즉시 반환 — Railway는 서버리스가 아니라 요청이 끝나도 백그라운드 프라미스가 계속 실행된다(기존 `docs/06-DEPLOY-RAILWAY.md` 전제와 동일).
3. 내부에서 에러 나면 `startVideoInvestigation` 자체가 `closeRun("failed", ...)`로 기록하므로 Server Action 쪽에서 별도 에러 처리 불필요.

## 테스트

- `startVideoInvestigation`이 정상 종료 시 `runs.status='done'`, 중간에 던지면 `'failed'`로 남는지 최소 1개 스크립트/수동 확인.
- 중복 클릭 시 두 번째 호출이 거절되는지("이미 진행중") 확인.
- `due()`가 더 이상 `/api/cron/video`, `/api/cron/video-analyze`를 자동으로 안 부르는지 코드 리뷰로 확인(로그로도 확인 가능).

## 범위 밖

- 영상 결과를 보여주는 화면 자체의 리디자인(이미 있다면 그대로 사용).
- 여러 워크스페이스가 같은 주에 동시에 [시작]을 누르는 경우의 정교한 분리(`video_keywords` 자체는 week 단위라 워크스페이스가 여러 개면 키워드가 섞일 수 있음 — 지금도 마찬가지였던 기존 한계이고, 이번 작업에서 새로 만들지 않음).
- 놓친 주차를 나중에 몰아보는 기능(4번 결정에서 배제됨).
