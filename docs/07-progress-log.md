# 진행 상황 로그

이 문서는 대시보드 구현이 실제로 진행되면서 "무엇을 언제 왜 했는지"를 세션 단위로 기록한다. 설계 자체의 근거는 `05-dashboard-master-spec.md`, UI 설계 결정은 `06-dashboard-ui-design.md`를 따로 본다.

---

## 2026-08-21

### 1. 폴더 분리 (구조 결정)

기존 `museofseoul`은 이미 배포된 서비스라, 대시보드 관련 문서·코드는 전부 별도 폴더 `museofseoul-dashboard/`로 분리했다. `museofseoul` 저장소는 건드리지 않았고, `museofseoul/CLAUDE.md`에 이 폴더를 가리키는 안내만 추가해 두었다.

- `museofseoul/docs/05-dashboard-master-spec.md` → `museofseoul-dashboard/docs/05-dashboard-master-spec.md`
- `museofseoul/docs/06-dashboard-ui-design.md` → `museofseoul-dashboard/docs/06-dashboard-ui-design.md`
- `museofseoul/docs/archive/` (03·04, 낡은 버전) → `museofseoul-dashboard/docs/archive/`
- `museofseoul/docs/01-sitemap-design.md`, `02-design-decisions.md`는 공개 사이트 문서라 그대로 둠

최종적으로 `/admin/*`에 통합할 시점은 아직 미정 — 그때 다시 논의.

### 2. UI 설계 1라운드 — 관측 보드 (`06-dashboard-ui-design.md` 참고)

프레임목업 → UI의사결정 → 테마선택 순서로 진행. `/admin/[category]` 관측 보드 화면 기준:

- 레이아웃(카테고리 4탭 + 장바구니, 서브탭, 정렬탭, 표/카드 전환), 표 9개 컬럼, 담기 상호작용, 데이터 신선도 라벨 위치까지 확정
- 테마는 기존 공개 사이트와 동일한 브랜드 테마(Editorial Plum/Seoul Mauve/Playfair Display+Montserrat)로 확정 — 운영툴 전용 대안은 기록만 남기고 보류

다른 화면(검수, 확산, 소재 만들기 등)은 아직 미착수.

### 3. "지표 계산 로직이 미정인데 설계가 의미 있나" — 범위 정리

경민이 급등률·경쟁강도 등의 **구체적 계산 방식·데이터 출처**가 아직 안 정해진 점을 지적. 확인 결과:

- **공식/틀은 이미 확정**(`05` §7.2): 언급량, 격차, 급등률, 경쟁강도의 계산 방식 자체는 정의돼 있음
- **그 공식에 넣을 구체값은 미정**(`05` §20): 대형매체 판정 기준, 스코어링 가중치, 서브레딧/RSS 목록 등 10개 항목
- UI·스키마는 "빈 자리"만 마련하는 것이라 이 미정 항목과 무관하게 진행 가능하다고 판단, 각 항목이 실제로 필요해지는 시점(S2~S9)에 그때그때 확인하기로 합의

### 4. S1 완료 — Supabase 스키마 생성 + `DATABASE_URL` 연결

**완료 기준**: 앱에서 keyword 1건 insert/select — **충족**.

- Supabase 프로젝트 생성 (region: `ap-northeast-2`, Seoul)
- 연결은 **Transaction pooler**(포트 6543) 사용 — direct connection(5432)은 IPv6 전용이라 로컬 환경에서 `EHOSTUNREACH`로 실패했음. pooler는 IPv4를 지원해 문제없이 연결됨 (막히면 이 문서를 참고)
- `05` §9.2 스키마를 `schema.sql`에 그대로 옮기고 `migrate.js`로 실행 — 12개 테이블(`keywords`, `mentions`, `keyword_daily`, `keyword_scores`, `ideas`, `idea_keywords`, `channel_outputs`, `revisions`, `affiliate_links`, `source_status`, `collection_rules`, `jobs`) 생성 완료
- `test-db.js`로 keyword 1건 insert → select → delete 왕복 확인

**파일 구조**:
```
museofseoul-dashboard/
  docs/                05·06·07, archive/
  schema.sql           §9.2 DDL
  db.js                pg Pool 클라이언트
  migrate.js           스키마 생성 (이미 있으면 건너뜀)
  test-db.js           insert/select/delete 테스트
  .env.local           DATABASE_URL (git 추적 제외)
  package.json         의존성: pg
```

**주의**: DB 비밀번호(`82704932km##`)가 이 세션 채팅에 두 번 노출됨. 실제 운영 전환 전에 Supabase 대시보드에서 재발급 권장.

### 5. S2 — `POST /api/ingest` 구현 (일부 완료)

**결정**: `museofseoul-dashboard`를 별도 Next.js 앱으로 만들고, 나중에 별도 Vercel 프로젝트로 배포하기로 함 (`museofseoul`과는 계속 분리 유지, `/admin` 통합은 나중에 별도 확인).

**이번 세션에서 한 것 (리포 안에서 할 수 있는 부분)**:
- `museofseoul-dashboard`에 Next.js(16.3.1, App Router, TypeScript) 세팅 추가 — `pg` 기반 로컬 스크립트(S1)와 공존
- `app/api/ingest/route.ts` 구현 — §14.1 계약대로:
  - `X-Api-Key` 헤더를 `N8N_INGEST_SECRET`과 대조, 불일치 시 401
  - `keyword_hint`가 같은 카테고리에 기존 키워드와 매칭되면 그 키워드에 연결, 없으면 `status='candidate'`로 새 키워드 생성(§10.1 — RSS 추출은 사람이 승격하기 전까지 candidate)
  - `mentions`는 `(source, external_id)` unique로 중복 방어 — 같은 요청 재전송해도 `skipped_duplicate`만 늘고 데이터는 안 겹침
  - 응답: `{ inserted, skipped_duplicate, new_keywords }`
- curl로 직접 검증: 정상 insert(1건), 잘못된 키 401, 같은 요청 재전송 시 dedup 정상 동작, DB에 candidate 상태로 저장되는 것까지 확인 → 테스트 데이터는 정리함
- `.env.local`에 `N8N_INGEST_SECRET` 랜덤 생성해서 추가 (n8n 쪽 HTTP 노드 헤더에 이 값을 넣어야 함 — 리포 밖 작업)
- Next.js 16이 `next dev` 실행 시 `AGENTS.md`/`CLAUDE.md`를 자동 생성함(`node_modules/next/dist/server/lib/generate-agent-files.js`) — 버전이 확실히 학습 시점과 다르다는 뜻이라 실제로 `next.config.js` 문법(ESM export 필요) 등에서 차이가 있었음. 앞으로 이 폴더에서 작업할 땐 이 자동 생성 파일 안내를 따를 것

**아직 안 한 것 (리포 밖 또는 사용자 확인 필요)**:
- n8n 워크플로우(RSS 피드 실제로 읽어서 이 엔드포인트로 전송) — VPS/n8n 설치 필요, 진행 여부 미확인
- 실제 배포(Vercel 프로젝트 생성, 도메인, 환경변수 설정) — 아직 로컬에서만 확인됨
- "해외 매체 RSS 최종 목록"(§20 항목 3) — 아직 안 정함, n8n 워크플로우를 실제로 만들 때 필요

---

## 현재 상태 요약

- 스키마 생성 완료, RSS 13개 소스에서 실제 333건 수집 완료(로컬 테스트 기준, `candidate` 상태) — S2 로직은 사실상 완료
- UI는 관측 보드 1개 화면만 설계됨
- 남은 것: **Vercel 실제 배포** (로컬에서만 확인됐고, 배포해야 매일 새벽 자동 실행이라는 S2 완료 기준이 완전히 충족됨), 그리고 LLM 기반 제품명 추출(현재는 단순화 상태)

### 6. n8n vs Vercel Cron — 재검토 (미정, 경민 확인 필요)

`05` 문서 D8·D9("n8n = VPS 셀프호스팅")는 이전 세션(4차 인터뷰)에서 기록된 결정인데, 경민이 이번 세션에서 "그렇게 정한 적 없다"고 이의 제기 — 재검토 필요.

RSS 수집 하나만 놓고 보면 n8n 없이 **Vercel Cron Job**(이 저장소 안에서 직접 구현)으로도 가능. 비교:

| | n8n (VPS) | Vercel Cron (이 코드베이스 안) |
|---|---|---|
| 장점 | 마스터스펙 전체 파이프라인(레딧·Trends·인스타·본문작성·이미지생성)이 이미 이 그림으로 설계됨. 재시도·실행이력·알림 내장. 배포 없이 워크플로우만 수정 가능 | 새 인프라 없이 즉시 시작 가능. VPS 관리 부담 없음. 추가 비용 없음 |
| 단점 | VPS 준비·운영 필요(도메인·HTTPS·방화벽, §16.3). 초기 셋업 비용 큼, 월 서버비 | 함수 300초 제한 — 나중에 본문작성·이미지생성처럼 오래 걸리는 단계엔 안 맞을 수 있음. 재시도·알림·소스별 커넥터를 직접 구현해야 함 |
| RSS 기준 구현 난이도 | 높음 (VPS 준비가 진입장벽) | 낮음~중간 |

**전환 비용**: `/api/ingest`가 원장의 유일한 입구로 설계돼 있어(§13.1), 어느 쪽으로 시작해도 DB 스키마·API 계약·앱 로직은 안 바뀜 — 나중에 반대쪽으로 옮길 때는 "엔드포인트를 호출하는 발신자"만 교체하면 됨. **낮음, 나중에 결정해도 구현상 문제 없음.**

다만 본문 작성·이미지 생성처럼 몇 분씩 걸리는 단계까지 Vercel Cron만으로 밀면 300초 제한에 막힐 가능성 있음 — 그 시점에 다시 논의.

**결정: Vercel Cron으로 진행** (경민 확정). n8n/VPS는 이번엔 안 씀 — 나중에 본문작성·이미지생성 단계에서 필요해지면 그때 재검토.

### 7. RSS 목록 확정 + Vercel Cron 구현 (S2 완료)

**RSS 목록**: 경민이 채팅에서 직접 조사한 13개 매체를 그대로 채택 (§20에서 권장한 4~6개보다 많지만, 본인이 직접 검증한 목록이라 임의로 줄이지 않음). 전부 curl로 HTTP 200 + 유효 XML까지 확인 후 진행:

K Beauty Hobbit · The Beauty Look Book · Pro Beauty Association News · Allure · Byrdie · Oprah Daily Beauty · PopSugar Beauty · Refinery29 Beauty · ELLE Beauty · Glamour · Teen Vogue Beauty · Self Beauty · WWD Beauty Inc

**구현**:
- `lib/ingest.ts` — `/api/ingest`와 크론 라우트가 같이 쓰는 공통 적재 로직으로 분리 (기존 route.ts에 있던 로직을 그대로 이동, 동작 변화 없음)
- `app/api/cron/collect-rss/route.ts` — Vercel Cron이 매일 호출할 라우트. `collection_rules`(source='rss')에서 피드 목록을 읽어와 `rss-parser`로 파싱 → `ingestItems()` 호출 → `source_status`에 성공/실패 기록(§17.4 연속실패 감지 로직 포함)
- `seed-rss-sources.js` — 위 13개를 `collection_rules`에 등록하는 1회성 스크립트 (재실행해도 중복 안 생김)
- `vercel.json` — `crons: [{ path: "/api/cron/collect-rss", schedule: "30 20 * * *" }]` (UTC 20:30 = KST 05:30, §15.1 그대로)
- **알려진 단순화(ponytail)**: `keyword_hint`를 지금은 기사 제목 그대로 씀. §6.2가 원래 의도한 "LLM이 제목에서 제품명만 추출"은 LLM API 키가 준비되면 업그레이드 — 지금은 후보(`candidate`) 상태로만 쌓이고 사람이 승격해야 관측 대상이 되니(§6.4), 품질 낮은 후보가 섞여도 비용이 크지 않다고 판단

**로컬 테스트 결과** (dev 서버 + curl로 직접 크론 호출):
- 13개 피드 전부 fetch 성공 (`feedsFailed: 0`)
- 실제 기사 333건 → `keywords` 333건(전부 `candidate`) + `mentions` 333건 생성
- 재실행 시 `totalInserted: 0, totalSkipped: 333` — 중복 방어 정상
- 인증 없이 호출 시 401
- `source_status`에 `source='rss', state='ok', consecutive_fails=0` 기록됨

**주의**: 이 333건은 테스트용이 아니라 **실제 수집된 진짜 데이터라 지우지 않고 그대로 둠**. 관측 보드가 아직 없어서 지금은 DB에서만 확인 가능.

**아직 안 한 것**:
- Vercel에 실제 배포 (지금까지 전부 로컬 dev 서버 기준 — 배포해야 Vercel Cron이 실제로 매일 자동 실행됨)
- LLM 기반 제품명 추출 (현재는 기사 제목 그대로)

---

## 2026-08-21 (계속) — 실 화면 연결 + Reddit 수집 (Apify)

### 8. 실제 관측 보드 화면 (`/admin/[category]`)

목업이 아니라 진짜 Next.js 페이지로 만듦 — Supabase에서 직접 쿼리해서 렌더링. 브랜드 테마(Playfair/Montserrat, Mauve 포인트) 적용.

- 현재 보이는 필드: 키워드명(=기사 제목), 최근 언급 제목, 출처, 언급수, 상태(candidate), 최초발견일
- 격차·급등률·경쟁강도·수익연결은 계산 로직이 없어 표시 안 됨 (S3 지표계산 미착수)
- 실제로 브라우저에서 확인함 — RSS로 모은 333건이 화면에 뜸. 단, 기사 제목을 그대로 키워드로 쓴 탓에 품질이 낮다는 게 화면으로 보니 바로 드러남(예: "The 2026 Beauty Power Products" 같은 게 "키워드"로 잡힘)

### 9. Reddit 공식 API 시도 → 막힘 → Apify로 우회

- `reddit.com/prefs/apps`에서 앱 생성 시도했으나 실패 반복. 원인 조사 결과 **2025-11부터 Reddit이 자율등록(self-service) API 접근을 종료**하고 수동 승인제(Responsible Builder Policy)로 전환한 것으로 확인됨. 익명 JSON 엔드포인트(`reddit.com/*.json`)도 직접 curl로 재확인 — 로그인 페이지로 리다이렉트, 막혀있음
- 대안으로 **Apify의 Reddit Scraper (`trudax/reddit-scraper-lite`)** 채택 — 로그인/승인 없이 즉시 사용 가능, 결과 1건당 $0.004
- n8n 아님 — 우리 구조(Vercel Cron) 그대로 유지, Apify를 REST로 직접 호출

### 10. 서브레딧 선정 방식 정정

- 처음엔 `05` 문서 §6.2의 "지정 키워드 검색"(레딧 전체에서 `k beauty` 등으로 검색) 방식을 시도했으나, 실측 결과 관련 없는 글이 대부분 섞여 나옴(예: 신발 레플리카 커뮤니티 글이 "k"에 매칭)
- **서브레딧을 지정해서 그 안에서만 수집하는 방식으로 정정** — r/AsianBeauty, r/SkincareAddiction 실제 테스트로 확인, 결과 품질 좋음
- 서브레딧은 Reddit 운영진이 정한 고정 카테고리가 아니라 사용자가 자유롭게 만드는 커뮤니티라는 점 확인 — 그래도 크고 오래된 커뮤니티는 실질적으로 안정적이라 운영상 고정 목록처럼 다뤄도 무방

### 11. `/admin/rules` — 수집 규칙 관리 화면 (경민 요청으로 추가)

§12.2에 있던 "수집 규칙 편집" 화면을 이번에 만듦. 이유: 서브레딧 하나하나 나(Claude)한테 검증 요청하는 게 느려서, 직접 추가/삭제/켜고끌 수 있게.

- 소스별(RSS/Reddit) 상태 카드 — 마지막 성공 시각, 직전 수집 건수, **"지금 실행" 버튼**(그 자리에서 바로 수집 트리거)
- 등록된 소스 목록 — 켜짐/꺼짐 토글, 삭제 버튼
- 새 소스 추가 폼 — 소스 종류·카테고리·값(URL 또는 서브레딧명) 입력
- Next.js Server Actions로 구현 (별도 API 라우트 없이 폼 제출 → DB 직접 반영 → 화면 자동 갱신)
- 브라우저로 토글 버튼 직접 눌러서 켜짐↔꺼짐 전환되는 것까지 확인함

구현 위치: `lib/collectors/rss.ts`, `lib/collectors/reddit.ts`(수집 로직을 공용 함수로 분리해 크론 라우트와 "지금 실행" 버튼이 같이 씀), `app/admin/rules/page.tsx` + `actions.ts`

### 12. Reddit 수집 — 알려진 한계 (ponytail)

Apify의 이 액터는 게시물마다 실제 헤드리스 브라우저로 페이지를 열어서 **느림** (개당 6~7초, 서브레딧당 최대 몇 분). 무료 요금제라 동시 실행 개수도 제한적이라, 서브레딧 여러 개를 `Promise.all`로 병렬 실행해도 기대만큼 빨라지지 않음(실측: 서브레딧 2개 동시 실행에 3분 이상 소요).

- **지금(서브레딧 2개)까지는 동작 확인됨** — Vercel 함수 제한(300초) 안에 들어옴
- **서브레딧이 더 늘어나면 300초를 넘길 위험이 있음** — 그때는 지금처럼 요청 안에서 다 기다리는 방식(동기) 대신, "일단 시작만 시키고 즉시 응답 → 나중에 결과만 따로 받아오는" 비동기 방식(웹훅 또는 폴링)으로 바꿔야 함. 지금 당장 그렇게 안 만든 이유: 로컬에서 테스트하기 더 어렵고(웹훅은 공개 주소 필요), 아직 배포 전이라 실익이 적어서. 배포 시점이나 서브레딧이 늘어나는 시점에 재검토
- 실측 결과: r/AsianBeauty 15건, r/SkincareAddiction 15건, 총 30건 정상 수집·저장 확인 (2026-08-21)

---

## 2026-08-23 — 관측 보드 UX 개선 + Reddit 수집 품질 필터

### 13. `/admin/rules` 별도 경로 폐지 → 카테고리 페이지에 통합

경민이 "route를 굳이 나눠야 하는 이유가 있냐"고 질문 → 없다고 판단, `/admin/rules`를 지우고 `/admin/[category]` 안에 "소스 관리" 섹션으로 병합. 액션 함수는 `lib/actions/rules.ts`, `lib/actions/keywords.ts`, `lib/actions/filters.ts`로 분리 보관.

### 14. 관측 보드 실질 기능 추가

- 각 행 제목 클릭 → 원문(기사/게시물)으로 새 탭 이동
- **담기 버튼**: `candidate → observing` 승격, `promoted_at` 기록 (스키마에 원래 있던 필드 사용, 새 컬럼 없음)
- RSS/Reddit을 완전히 분리된 섹션·표로 표시(기존엔 "출처" 컬럼 하나로 섞여 있었음)
- 각 섹션 맨 위에 "몇 시에·어디를·몇 곳" 수집하는지 안내문 표시

### 15. Reddit 소스 5개로 확장 + 수집 방식 변경

- AsianBeauty(꺼져 있던 것 다시 켬) + 신규 30PlusSkinCare·KoreanBeauty·muacjdiscussion → Apify로 실존/활성 여부 실측 확인 후 추가
- r/oliveyoung은 **존재하지 않음**(Apify 조회로 확인) — 올리브영 언급은 브랜드명 추출(§16) 붙으면 AsianBeauty/KoreanBeauty 안에서 걸러야 함
- koreatravel·Living_in_Korea·Seoul은 실존 확인은 했지만 **아직 안 넣음** — 나중에 'stay' 카테고리용으로 보류
- 수집 정렬을 `/new/`(최신순) → `/top/?t=week`(이번 주 인기순)로 변경, 서브레딧당 개수 15→10개
- 크론 주기를 매일 → **매주 월요일 새벽 05:20(KST)**로 변경(`vercel.json`) — Apify 실행 횟수가 줄어 비용 절감(추정 월 85~90%↓)
- 새 테이블 `title_excludes` 추가(정기 게시판/잡담글 제목 필터, 대시보드에서 직접 추가·삭제) — **스키마 변경 전 §9.2 문서에 먼저 반영 후 적용**
- 화면에 톱니바퀴(⚙) 패널 추가 — 지금 적용 중인 정렬·개수·주기·제외단어를 텍스트로 표시
- 제목의 대괄호 태그(`[Routine Help]` 등)로 수요형/정보형 배지 표시(패턴 매칭, LLM 아님)
- 댓글비율(댓글수÷업보트) 정렬 옵션 추가
- 서브레딧별 토글 필터(전체/개별) 추가
- 내부 이동 링크를 전부 `next/link`의 `scroll={false}`로 교체 — 정렬·필터 클릭 시 페이지 전체 리로드/스크롤 초기화되던 문제 해결

### 16. Apify 사용량 확인

과거 실행 기록(`GET /v2/acts/.../runs`, 무료 메타데이터 조회)으로 확인 — 2026-08-21~23 사이 총 25회 실행, $1.6521 / $5(월 한도 33%) 사용. 대부분 개발/테스트 중 수동 실행이었고 실제 매일/매주 크론 자체의 비용은 훨씬 적음.

### 17. 카테고리별 데이터 현황 확인

`treatments`, `stay`, `where-to-go`는 **키워드·소스 전혀 없음** — 화면 구조만 있고 아직 아무 것도 수집 안 되는 빈 카테고리. `products`만 실제 운영 중(키워드 363건).

---

## 다음으로 미룬 작업 (백로그)

- **브랜드/제품명 키워드 추출** — 지금 키워드가 원문 제목 그대로라 "언급수"가 거의 항상 1로 나오는 원인. 설계만 해둔 상태:
  - 1단계(무료): 자주 나오는 K-beauty 브랜드명 리스트 매칭
  - 2단계(LLM, API 키 필요): 리스트에 없는 신규 브랜드 추출
- treatments / stay / where-to-go 카테고리용 RSS·Reddit 소스 선정 및 등록
- koreatravel / Living_in_Korea / r/Seoul → 'stay' 카테고리용으로 추가
- 지표 계산 로직(격차·급등률·경쟁강도·수익연결) — Google Trends·SERP API 계정 필요
- "메이저 매체" 도메인 화이트리스트 (§20 미확정)
- 장바구니 이후 소재 만들기(§21 S5+) 파이프라인
- 실제 Vercel 배포 (경민이 "다 작업 후"로 명시적으로 미룸)
- Reddit 수집 타임아웃 리스크 — 서브레딧이 더 늘어나면 동기 방식(현재) 대신 비동기(웹훅/폴링)로 전환 검토

## 현재 상태 요약 (갱신)

- **작동 확인된 수집 소스**: RSS 13개(products), Reddit 5개 서브레딧(products) — 전부 실제 데이터, 주간 인기순으로 전환됨
- **작동 확인된 화면**: `/admin/[category]` 관측 보드 — RSS/Reddit 섹션 분리, 원문 링크, 담기 버튼, 서브레딧 토글, 정렬 토글, 소스 관리(추가·삭제·켜기끄기·수동실행)까지 한 화면에 통합. `/admin/rules`는 폐지됨
- **아직 없는 것**: 브랜드명 추출, 지표 계산, 장바구니 이후 파이프라인, 다른 3개 카테고리 소스, 실제 배포
- **알아둘 위험**: Reddit 수집은 서브레딧이 더 늘어나면 타임아웃 위험 있음(§12 참고, 주간 전환으로 빈도는 줄었지만 개당 렌더링 시간 자체는 그대로)

---

## 전체 로드맵 현황 (2026-08-23 기준, §21 착수 순서 대조)

`docs/05-dashboard-master-spec.md` §21·§20·§18 기준으로 지금까지 실제 확인된 상태를 대조한 스냅샷. 지금 위치는 **S3 초입**(보드 화면은 있으나 지표 계산 없음).

| 단계 | 작업 | 완료 기준 | 상태 |
|---|---|---|---|
| **S1** | Supabase 스키마 + DATABASE_URL 연결 | keyword 1건 insert/select | ✅ 완료 |
| **S2** | 수집 적재 + RSS 수집 | 새벽에 키워드 자동으로 쌓임 | ✅ 완료 (n8n 대신 Vercel Cron, RSS 13곳) |
| **S3** | 지표 계산 + 관측 보드(표) | 폰에서 키워드·언급량 보임 | 🟡 보드 화면만 있음 — 격차·급등률·경쟁강도·수익연결 지표 계산 없음 |
| **S4** | Reddit + Trends(KR/US) → 격차 지표 | 「국내 선행」/「해외 선행」 배지 | 🟡 Reddit만 됨(5곳, 순서상 S2 직후로 앞당김) — Trends 없음, 배지 없음 |
| **S5** | 장바구니 + `/admin/compose` | 키워드 담아 소재 만들기 | 🟡 "담기"(candidate→observing)까지만, 소재 만들기 화면 없음 |
| **S6** | dispatch/callback + 본문 워크플로우 연결 | 소재 만들면 초안이 review로 도착 | ⬜ 미착수 |
| **S7** | 검수 화면 + Sanity 발행 | 폰에서 승인하면 사이트에 글 뜸 | ⬜ 미착수 |
| **S8** | 인스타(Business Discovery+해시태그) + 피드 탭 | 30계정 새 글, 떠오르는 키워드 | ⬜ 미착수 |
| **S9** | 채널 변환 + 이미지 생성 + 확산 화면 | 소재가 선택 채널로 다 나감 | ⬜ 미착수 |
| **S10** | 상태 페이지 + 텔레그램 알림 + 수집 규칙 편집 | 소스 죽으면 알림, 배포 없이 키워드 추가 | 🟡 수집 규칙 편집은 됨 — 상태 페이지·텔레그램 알림 없음 |

### §20 미해결 항목 현황

| 항목 | 상태 |
|---|---|
| 스코어링 가중치 수치 | 미정 |
| 레딧 서브레딧 최종 목록 | products는 5개 확정, 나머지 3개 카테고리 미정 |
| 해외 매체 RSS 최종 목록 | products는 13개 확정, 나머지 3개 카테고리 미정 |
| 인스타 해시태그 30개 | S8 착수 전이라 해당 없음 |
| 인스타 계정 프로페셔널 여부 | 〃 |
| 수집 퍼널 실측 보정치 | 4주 운영 후 결정, 운영 전 |
| "대형매체" 판정 기준(도메인 화이트리스트) | 미정 (경쟁강도 지표에 필요) |
| 이미지 생성 API 선택 | S9에서 필요 |
| Apify 구체 용도 | Reddit 수집으로 실사용 중 — 사실상 해소 |
| 제휴 프로그램 네트워크 가입 | 2차 범위, 미착수 |

### 다음 우선순위 (백로그 재확인)

1. 브랜드/제품명 키워드 추출 (S3 "언급수"를 의미 있게 만드는 선행 작업)
2. Treatments/Stay/Where to go 카테고리 소스 채우기
3. S3 지표 계산 (Google Trends·SERP API 계정 필요)
4. S4 Trends(KR/US) 연동 → 격차 지표 배지
5. S5 장바구니 이후 소재 만들기 화면
6. 실제 Vercel 배포 (경민이 "다 작업 후"로 명시적으로 미룸)

§18.2 제외 항목(수익 대시보드, GA4 연동, 채널 API 자동 게시, 제휴 상품 자동 추천, 강남언니 수집, 협찬 관리)은 2차 범위라 지금 할 일 목록에서 제외.

---

## 2026-08-24 — Instagram 파이프라인 착수 (docs/08 참고)

`docs/instagram_apify.md`(museofseoul/docs/instagram_apify.md에서 복사, 파일명 그대로 유지) 기준으로 신규 페이지 `/admin/instagram` 착수. 기존 관측 보드(K-Beauty Products 등)와는 완전히 별개 서브시스템 — 나중에 연결 예정.

**완료·검증됨**:
- DB 스키마 3개 테이블(`instagram_watchlist`, `instagram_mentions`, `instagram_dm_captures`) — `schema.sql`에 반영, 실제 생성 확인
- `/admin/instagram` — 워치리스트 추가/삭제/켜기끄기, 요약 카드 4개, "2주+ 미갱신" 섹션(자동 비활성화 없이 표시만) — 실제 계정 추가/삭제로 검증
- 수집 파이프라인(`lib/collectors/instagram.ts`) — Apify `apify/instagram-scraper` 실제 호출로 필드명 검증 후 구현. `@nasa` 계정으로 실제 수집→저장까지 확인(게시물 1건, 좋아요/댓글수/게시시각 정상 저장), 테스트 데이터는 정리함
- 수집 소요시간: 계정 1개당 약 15초 (Reddit보다 느림 — 여러 계정 늘어나면 참고)

**LLM 분석 단계도 완료·검증됨 (2026-08-24)**:
- `OPENAI_API_KEY`, `GEMINI_API_KEY` 경민이 발급해서 `.env.local`에 채움 — 실제 호출로 둘 다 유효함 확인(모델 목록 조회)
- `lib/analyzers/instagram.ts` — is_informational 필터 + 4개 카테고리 분류를 gpt-4o-mini로 구현, `/admin/instagram`에 "지금 분석 실행" 버튼 + 결과 표 추가
- `@nasa` 게시물로 실제 분석 실행 확인 — is_informational=false(뷰티 관련 정보 없음)로 정확히 판정, DB 반영까지 확인. 테스트 데이터는 정리함
- **주의**: 지금 구현은 텍스트(캡션) 분석만 함. 캐러셀 vision 분기(§2, 캡션 30자 미만일 때 이미지로 GPT-4o/Gemini 비교)는 아직 안 만듦 — 실제 캐러셀 케이스로 테스트할 때 추가 예정
- 수집 소요시간 편차 큼: 첫 테스트 15초 → 이번 테스트 65초. 계정/게시물마다 다를 수 있어 계속 관찰 필요

**보류 중 (문서에 별도 기록)**:
- 프록시 IP 고정 — 댓글 자동화 단계 만들 때, 테스트 결과 보고 최종 결정
- VPS(Hetzner, 62.238.61.45) SSH 접근 — IP는 받음, 계정명/비밀번호(또는 키) 아직 안 받음. n8n과 동시 운영 시 여유 리소스 확인 필요
- 댓글 자동 게시·DM 확인(§5·§6) — 위 두 가지 정리된 뒤 착수

## 2026-08-24 (계속) — 순서 재확인 + 워치리스트 재설계

**중요한 방향 수정**: 처음엔 "계정 5개만 테스트"를 §1·§2(수집·분석)만 도는 축소판으로 진행하려 했으나, 경민이 명확히 정정 — 5개는 축소판이 아니라 **§1~§6(수집→분석→댓글자동화→DM수신) 전체가 실제로 돌아가는 구조를 먼저 갖춘 뒤, 그 중 5개 계정으로 첫 실행**을 해보는 것. 부분 기능만 만들고 "트라이얼"이라 부르는 방식은 잘못됐다고 명시적으로 지적받음.

같은 맥락에서 워치리스트 방식도 재설계: 직접 추가/삭제하는 폼(기존 `/admin/instagram`, `lib/actions/instagram.ts`의 `addWatchlistAccount` 등)은 경민이 원한 방식이 아니었음 — **서브계정(`mylittlewellness_`)이 실제로 팔로우 중인 계정 목록을 Apify로 읽어와 자동 동기화**하는 방식이 맞는 방향으로 확정. 언팔로우되면 자동 비활성화. 아직 구현 전, Apify로 팔로잉 목록 조회가 실제 가능한지 기술 검증부터 필요.

VPS SSH 접속 정보(사용자명/비밀번호) 확보 완료, Claude가 직접 원격 접속해 작업하는 것으로 확정.

**전체 착수 전 확정 사항 정리 (경민 요청으로 14개 항목 한 번에 확인)**:
- 서브계정: `mylittlewellness_`, 팔로잉 목록 공개, 언팔 시 자동 비활성화
- VPS 원격 접속(Claude가 직접) 승인
- 2FA는 켜둔 채 진행 — 최초 1회 수동 로그인 때만 경민이 직접 코드 입력, 이후 세션 재사용이라 스크립트가 2FA를 다룰 필요 자체가 없음(안전)
- VPS "프로젝트" 분리 불필요 — n8n과 같은 서버에서 별개 프로세스로 공존 가능
- QStash = Upstash의 제품 확인, 가입 절차 안내 완료(경민 가입 대기)
- 프록시는 이미 보류로 결정된 사항 — 재확인 없이 유지
- 도메인: museofseoul.com 보유 확인, 블로그 배포 여부와 무관하게 서브도메인 DNS 레코드만 추가하면 됨. 등록업체 확인 대기
- 수집 시각 09:00 KST, 캡션 임계값 30자, 캐러셀 vision 슬라이드 상한 5장, 정보성 알림 임계치 하루 20개 — 전부 확정
- 수집량(계정당 2개, 주 2회)은 스펙에 이미 있던 값 — 코드가 테스트용 1개로 남아있는 게 버그였을 뿐, 재확인 불필요했음

`docs/instagram_apify.md`에 위 내용 전부 반영 완료(체크리스트, §1 대상 설명, 인프라 노트, 확보사항 표, 남은 확인사항 갱신).

**다음**: 워치리스트 자동 동기화 기술 검증(Apify 팔로잉 목록 조회 가능 여부) → 확정되면 §1~§6 전체 구현 착수. 코드는 경민의 명시적 승인 전까지 아직 손대지 않음.

## 2026-08-25 — Contents Dashboard 라우팅 재설계 (topic × platform)

**배경**: 좌측 플랫폼 네비게이터(인스타그램/RSS/Reddit)를 가진 "Beauty Contents Dashboard" 화면을 먼저 만들었는데, 우측 상단에 K-Beauty/Stay/Where to go 주제 전환 버튼을 추가하는 요구가 이어지면서 방향이 명확해짐: 기존 인스타그램 서브시스템(`/admin/instagram`)과 관측 보드(`/admin/[category]`, RSS/Reddit)가 서로 다른 라우팅 체계로 나뉘어 있던 걸 하나로 합쳐야 함 — **주제(topic) × 플랫폼(platform) 2차원 라우팅**으로 전면 재구조화.

**완료·검증됨**:
- 라우팅: `/admin/[topic]/[platform]`, topic ∈ {k-beauty, stay, where-to-go} × platform ∈ {dashboard, instagram, rss, reddit, google, history}. 상단 주제 버튼은 현재 플랫폼을 유지한 채 topic만 바꾸고, 좌측 플랫폼 링크는 현재 topic을 유지한 채 platform만 바꿈
  - 예: `/admin/k-beauty/instagram`(K-beauty 워치리스트), `/admin/stay/rss`(Stay의 RSS), `/admin/where-to-go/history`(Where to go 이력)
- `lib/topics.ts` 신설 — URL slug(`k-beauty` 등)와 DB `category` 컬럼값(`products` 등, 기존 enum 그대로 유지)이 다른 문제를 이 파일 하나로만 매핑
- 공통 셸 `components/DashboardShell.tsx`(좌측 6항목 고정 네비, 아이콘+연보라 배경, sticky) + `components/TopicSwitcher.tsx`(우측 상단, 테두리 없음, 현재 주제 강조 표시, `position: fixed` 아니라 스크롤하면 같이 사라짐) — 홈(`/`)과 `[topic]/layout.tsx` 양쪽에서 공유
- 기존 `app/admin/(beauty)/*`(인스타그램 서브시스템 전용 라우트 그룹)와 `app/admin/[category]/page.tsx`(구 관측 보드, 572줄)를 완전히 삭제하고 주제별 `rss/page.tsx`·`reddit/page.tsx`로 흡수
- `source_status` 테이블에 `category` 컬럼 추가(복합 PK `(source, category)`)해서, RSS/Reddit 실행 이력이 플랫폼별+주제별로 분리 기록되도록 마이그레이션(라이브 DB 반영 완료)
- K-beauty Dashboard 탭: 인스타그램/RSS/Reddit/Google 4칸 카드(전부 "준비 중" 자리만 마련, 실데이터 연결은 아직) — "매주 2회 수집(토요일 오전 트리거) → 일요일 새벽 갱신" 안내 문구 포함
- **좌측 네비 항목별 실데이터 현황** (Dashboard 탭 카드가 "준비 중"인 것과는 별개로, 각 네비 페이지 자체는 아래처럼 다름):
  - Dashboard — 전부(k-beauty 포함) "준비 중" placeholder만
  - 인스타그램 — k-beauty만 실데이터(워치리스트/미분석검토 등 실제 동작), Stay·Where to go는 준비 중
  - RSS / Reddit — 주제별로 실제 DB 데이터 연결됨(3개 주제 전부 동작, 다만 Stay·Where to go는 소스가 아직 없어 0건)
  - Google — 완전한 껍데기, 라우트만 있고 데이터 없음
  - 이력 — 인스타그램(k-beauty만) + RSS/Reddit(주제별) 실제 상태 표시
- 이력 탭: 인스타그램(k-beauty만 실데이터) + RSS/Reddit 최근 상태 카드, 주제별로 분리되어 표시 확인
- 버그 수정 2건: ① RSS/Reddit "소스 관리" 표가 `category` 필터 없이 전체 주제 데이터를 노출하던 것(Stay 탭에서 K-beauty 소스 13개가 보이던 문제) → 쿼리에 `and category = $1` 추가로 해결 ② "워치리스트에서 시간경과로 빠짐" 진단 표를 만들었는데, 검증해보니 실제로는 기존 "미분석 검토" 표와 완전히 동일한 15건이었음(경민이 직접 지적, 재확인 후 확정) — 근거 없는 표였던 걸 확인하고 전체 삭제

**보류·미정**:
- Google 탭 — 라우트만 있고 실데이터 수집 없음
- 주제별 Dashboard 집계 콘텐츠 — 4칸 전부 "준비 중" placeholder
- Stay/Where to go — 전 플랫폼 데이터 0건(설계상 아직 미착수, 버그 아님)
- 홈(`/`) 화면 실제 콘텐츠 없음, "준비 중" 문구만
- 실제 Vercel 배포 미실행(§20 백로그의 기존 항목과 동일 — "다 작업 후"로 미룸)
