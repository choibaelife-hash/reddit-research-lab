# Reddit + RSS 수집 파이프라인 — 핸드오프 문서

museofseoul-dashboard는 4개 소스(Instagram, Google, RSS, Reddit)를 수집·분석하는 콘택트 대시보드입니다.
이 문서는 그중 **RSS + Reddit 두 파이프라인**을 별도 개발환경(다른 AI 툴)에서 이어서 작업할 수 있도록
폴더 위치, 코드 구조, 이미 등록된 호출값, 환경변수, DB 스키마를 정리한 것입니다.

## 1. 프로젝트 구조 (관련 파일만)

```
museofseoul-dashboard/
├── lib/
│   ├── collectors/
│   │   ├── reddit.ts        ← Reddit 수집기 (Apify 스크래퍼)
│   │   └── rss.ts           ← RSS 수집기 (범용, 뷰티 블로그/매거진용)
│   ├── ingest.ts            ← 공용 dedup + 키워드 추출 (두 수집기 모두 사용)
│   ├── db.ts                ← Postgres pool (공용)
│   ├── topics.ts            ← 카테고리↔토픽 매핑 (공용)
│   └── actions/
│       ├── rules.ts         ← addRule/deleteRule/toggleRule, runRss(), runReddit()
│       └── filters.ts       ← 제목 제외어 관리 (현재 reddit 화면에서만 씀)
├── app/
│   ├── api/cron/
│   │   ├── collect-reddit/route.ts   ← 크론 엔드포인트 (Bearer CRON_SECRET)
│   │   └── collect-rss/route.ts      ← 크론 엔드포인트 (Bearer CRON_SECRET)
│   └── admin/[topic]/
│       ├── reddit/page.tsx  ← Reddit 관리 화면 (소스 추가/삭제, 수동실행, 제외어)
│       └── rss/page.tsx     ← RSS 관리 화면
├── seed-reddit-sources.js   ← Reddit 초기 시드 스크립트 (npm run seed-reddit)
├── seed-rss-sources.js      ← RSS 초기 시드 스크립트 (npm run seed-rss)
├── schema.sql               ← DB 스키마 (아래 3번 참고)
├── vercel.json               ← 크론 스케줄
└── .env.local                ← 환경변수 (값은 비공개, 이름만 4번 참고)
```

## 2. 데이터 흐름 (공용 파이프라인)

```
collection_rules (Postgres 테이블)
  → reddit.ts / rss.ts 가 source별로 읽어서 외부 호출
  → ingestItems() 가 keywords/mentions 테이블에 dedup 저장
  → updateSourceStatus() 가 source_status 테이블 갱신 (ok/degraded/down)
```

**"이미 호출된 값"은 코드 안이 아니라 Postgres DB의 `collection_rules` 테이블에 들어있습니다.**
파일에 박힌 상수가 아니라 대시보드에서 실시간으로 추가/삭제 가능한 값입니다.
아래는 그 값의 **초기 시드 기준**(seed 스크립트 = 현재 값의 원본)입니다.

## 3. 이미 호출된 값 (실제 파라미터)

### Reddit (`lib/collectors/reddit.ts`)

```
호출 방식     : Apify actor (공식 Reddit API 아님)
actor id     : trudax~reddit-scraper-lite
호출 URL     : https://api.apify.com/v2/acts/trudax~reddit-scraper-lite/run-sync-get-dataset-items?token={APIFY_API_TOKEN}
요청 body    : {
  startUrls: [{ url: "https://www.reddit.com/r/{subreddit}/top/?t=day" }],
  maxItems: 10,
  maxPostCount: 10,
  skipComments: true,
  skipUserPosts: true,
  skipCommunity: true,
  includeMediaLinks: false
}
서브레딧당 최대: 10개 (MAX_ITEMS_PER_SUBREDDIT)
정렬         : top, t=day  ※주의: 화면(page.tsx) 안내문구는 "t=week"로 되어있어 코드와 불일치 — 확인 필요
크론 스케줄   : vercel.json → "20 20 * * 0" (UTC 일요일 20:20 = KST 월요일 05:20)

현재 시드된 서브레딧 (seed-reddit-sources.js, category='products'):
  - AsianBeauty
  - SkincareAddiction
```

### RSS (`lib/collectors/rss.ts`)

```
호출 방식     : rss-parser 패키지로 각 URL의 RSS/Atom 피드 직접 파싱 (API 아님, 순수 XML 파싱)
timeout      : 15000ms
크론 스케줄   : vercel.json → "30 20 * * *" (매일 UTC 20:30 = KST 05:30)

현재 시드된 RSS 피드 (seed-rss-sources.js, category='products' 13개):
  - K Beauty Hobbit        https://kbeautyhobbit.com/blog-feed.xml
  - The Beauty Look Book   https://thebeautylookbook.com/feed
  - Pro Beauty Assoc News  https://probeauty.org/news/feed/
  - Allure                 https://www.allure.com/feed/rss
  - Byrdie                 https://feeds-api.dotdashmeredith.com/v1/rss/google/6772aca0-2ce6-4ccc-8a40-d5556ba3a9c7
  - Oprah Daily Beauty     https://www.oprahdaily.com/rss/beauty.xml
  - PopSugar Beauty        https://www.popsugar.com/beauty/feed
  - Refinery29 Beauty      https://www.refinery29.com/beauty/rss.xml
  - ELLE Beauty            https://www.elle.com/rss/beauty.xml/
  - Glamour                https://www.glamour.com/feed/rss
  - Teen Vogue Beauty      https://www.teenvogue.com/feed/rss
  - Self Beauty            https://www.self.com/feed/rss
  - WWD Beauty Inc         https://wwd.com/feed/rss/
```

※ 현재 RSS 목록에 **reddit.com 도메인은 없습니다.** 레딧을 RSS로도 받고 싶으면
`https://www.reddit.com/r/{subreddit}/.rss` 형태 URL을 `collection_rules(source='rss')`에
추가하면 기존 rss.ts가 그대로 처리합니다 (별도 개발 불필요, 등록만 하면 됨).

## 4. 환경변수 (이름만 — 값은 `.env.local`에 있고 공유하지 않음)

```
DATABASE_URL      → lib/db.ts, 두 수집기 공용
APIFY_API_TOKEN   → reddit.ts (instagram.ts도 같이 씀)
CRON_SECRET       → 두 크론 route.ts의 Bearer 인증
```

## 5. DB 스키마 (관련 테이블만, schema.sql)

```sql
collection_rules (id, category, source, value, enabled, created_at)
  -- value = 서브레딧명 또는 RSS URL, source = 'reddit' | 'rss'
  -- unique (category, source, value)

source_status (source, category, last_success_at, last_attempt_at,
                last_count, consecutive_fails, state)
  -- state: 'ok' | 'degraded' | 'down'

keywords (id, label, summary, category, status, first_seen_at, ...)
  -- category: 'products'|'treatments'|'stay'|'where-to-go'
  -- status: 'candidate'|'observing'|'archived'

mentions (id, keyword_id, source, external_id, url, title, raw, occurred_at, collected_at)
  -- source: 'reddit'|'rss'|'trends'|'gsc'|'instagram'|... (unique: source+external_id → 중복 방지)

title_excludes (id, value, enabled)  -- reddit 화면에서 제목 필터링용
```

## 6. 의존 패키지

```
rss-parser ^3.13.0   (RSS 파싱)
pg ^8.13.1           (Postgres)
```

Reddit 쪽은 외부 패키지 없이 순수 `fetch`로 Apify를 호출합니다.
