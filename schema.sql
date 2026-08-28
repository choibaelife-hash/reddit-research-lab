-- 레딧 K-뷰티 소재 발굴 시스템 — 스키마 전체
--
-- 적용:  node --env-file=.env.local scripts/apply-schema.mjs
--
-- 이 파일 하나가 이 프로젝트의 전부다.
-- 예전에는 schema.sql(museofseoul에서 복사) + migrate-analysis.js + migrate-reddit-rss.js
-- 세 군데에 흩어져 있었고, schema.sql에는 이 프로젝트가 쓰지도 않는
-- 인스타그램·제휴링크 테이블이 남아 있어 이걸로 새 환경을 세팅하면 앱이 뜨지 않았다.
--
-- 여러 번 실행해도 안전하다 (if not exists / on conflict).

-- ══════════════════════════════════════════════════════════
-- 1. 수집 원본 — 재분석해도 여기는 건드리지 않는다
-- ══════════════════════════════════════════════════════════

create table if not exists keywords (
  id            uuid primary key default gen_random_uuid(),
  label         text not null,
  summary       text,
  category      text not null check (category in ('products','treatments','stay','where-to-go')),
  status        text not null default 'observing'
                check (status in ('candidate','observing','archived')),
  first_seen_at timestamptz not null default now(),
  promoted_at   timestamptz,
  merged_into   uuid references keywords(id),
  created_by    text default 'auto',
  updated_at    timestamptz not null default now()
);

create table if not exists mentions (
  id            uuid primary key default gen_random_uuid(),
  keyword_id    uuid not null references keywords(id) on delete cascade,
  source        text not null check (source in
                  ('reddit','rss','trends','gsc','instagram','oliveyoung','babitalk','klook','agoda','manual')),
  external_id   text not null,
  url           text,
  title         text,
  raw           jsonb default '{}'::jsonb,   -- body, subreddit, rank 등 원자료
  occurred_at   timestamptz not null,
  collected_at  timestamptz not null default now(),
  unique (source, external_id)               -- ★ 중복 실행 방어의 핵심
);

-- ══════════════════════════════════════════════════════════
-- 2. 수집 설정 — 화면에서 편집한다
-- ══════════════════════════════════════════════════════════

create table if not exists collection_rules (
  id         uuid primary key default gen_random_uuid(),
  category   text not null,
  source     text not null,
  value      text not null,                       -- 서브레딧 / RSS URL
  enabled    boolean not null default true,
  options    jsonb not null default '{}'::jsonb,  -- reddit: {"period":"week"|"month"}
  created_at timestamptz not null default now(),
  unique (category, source, value)
);

-- 정기 게시판(요일 스레드 등)은 소재가 안 된다. 제목으로 거른다.
create table if not exists title_excludes (
  id         uuid primary key default gen_random_uuid(),
  value      text not null unique,
  enabled    boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists source_status (
  source            text not null,
  category          text not null default 'products',
  last_success_at   timestamptz,
  last_attempt_at   timestamptz,
  last_count        int,
  consecutive_fails smallint not null default 0,
  state             text not null default 'ok' check (state in ('ok','degraded','down')),
  note              text,
  primary key (source, category)
);

-- ══════════════════════════════════════════════════════════
-- 3. 분석 결과 — 원본과 분리해 쌓는다
-- ══════════════════════════════════════════════════════════

create table if not exists post_analysis (
  mention_id   uuid primary key references mentions(id) on delete cascade,
  category     text,
  post_type    text,          -- 추천요청 | 비교질문 | 후기리뷰 | 경험공유 | 진단도움 | 경고이슈 | 정보설명 | 잡담
  beauty_area  text,          -- 스킨케어루틴 | 선케어 | 트러블여드름 | ... | 바디헤어
  topic        text,          -- 정규화된 주제 (같은 주제끼리 묶는 열쇠)
  topic_en     text,
  summary_ko   text,
  awareness    text,          -- 정확히앎 | 대충앎 | 오해 | 처음들음
  worth        smallint,      -- 소재 가치 0~100
  worth_parts  jsonb,         -- 점수 근거. 왜 이 점수인지 따져볼 수 있게 남긴다
  misconception jsonb,        -- {has, what, correction}
  korea_relevance jsonb,
  comments_checked_at timestamptz,
  layer        smallint not null default 1,
  model        text,
  analyzed_at  timestamptz not null default now()
);
create index if not exists post_analysis_topic_idx on post_analysis (topic);
create index if not exists post_analysis_worth_idx on post_analysis (worth desc);

create table if not exists post_comments (
  mention_id  uuid not null references mentions(id) on delete cascade,
  rank        smallint not null,
  author      text,
  body        text not null,
  body_ko     text,
  fetched_at  timestamptz not null default now(),
  primary key (mention_id, rank)
);

-- ══════════════════════════════════════════════════════════
-- 4. 누적 자산 — 주마다 쌓이고 사라지지 않는다
-- ══════════════════════════════════════════════════════════

create table if not exists entities (
  id             uuid primary key default gen_random_uuid(),
  kind           text not null check (kind in
                   ('clinic','treatment','product','brand','place','ingredient','channel','procedure')),
  canonical_name text not null,
  name_ko        text,
  aliases        text[] not null default '{}',   -- Seoul Sy ↔ 서울에스와이피부과의원
  meta           jsonb  not null default '{}'::jsonb,
  first_seen_at  timestamptz not null default now(),
  unique (kind, canonical_name)
);

-- role이 PK에 들어가야 "같은 병원을 본문에선 문의, 댓글에선 추천"을 따로 기록할 수 있다.
create table if not exists entity_mentions (
  entity_id   uuid not null references entities(id) on delete cascade,
  mention_id  uuid not null references mentions(id) on delete cascade,
  source_kind text not null default 'post' check (source_kind in ('post','comment')),
  role        text not null default '',
  sentiment   text,
  quote       text,
  created_at  timestamptz not null default now(),
  primary key (entity_id, mention_id, source_kind, role)
);
create index if not exists entity_mentions_mention_idx on entity_mentions (mention_id);

create table if not exists demand_signals (
  mention_id     uuid primary key references mentions(id) on delete cascade,
  age_band       text,
  origin         text,
  budget         text,
  stay_duration  text,
  goals          text[] not null default '{}',
  constraints    text[] not null default '{}',
  concerns       text[] not null default '{}',
  extracted_at   timestamptz not null default now()
);

-- ══════════════════════════════════════════════════════════
-- 5. 사람이 고른 것
-- ══════════════════════════════════════════════════════════

create table if not exists idea_cards (
  mention_id   uuid primary key references mentions(id) on delete cascade,
  angles       jsonb not null default '[]'::jsonb,   -- [{ko,en,guide}]
  gap          text,                                  -- 정보 격차
  detail       jsonb not null default '{}'::jsonb,
  status       text not null default 'candidate'
               check (status in ('candidate','saved','published','held','dropped')),
  note         text,
  chosen_angle smallint,
  saved_at     timestamptz,
  published_at timestamptz,
  updated_at   timestamptz not null default now()
);

-- ══════════════════════════════════════════════════════════
-- 6. 기본 데이터
-- ══════════════════════════════════════════════════════════

-- 레딧 4개 서브레딧. muacjdiscussion은 week로 받으면 12건뿐이라(2026-08-25 실측) 월간으로 넓힌다.
insert into collection_rules (category, source, value, options) values
  ('products', 'reddit', 'KoreanBeauty',       '{"period":"week"}'),
  ('products', 'reddit', 'AsianBeauty',        '{"period":"week"}'),
  ('products', 'reddit', 'SkincareAddiction',  '{"period":"week"}'),
  ('products', 'reddit', '30PlusSkinCare',     '{"period":"week"}'),
  ('products', 'reddit', 'muacjdiscussion',    '{"period":"month"}')
on conflict (category, source, value) do nothing;

-- 정기 게시판 제목. 기존 4개로는 요일 스레드가 8개 중 7개 통과해 버렸다.
insert into title_excludes (value) values
  ('Faves and Fails'), ('Simple Questions'), ('Temper Tantrum'),
  ('Miscellaneous Monday'), ('Free Talk'), ('Request a Review'), ('Not Gonna Buy')
on conflict (value) do nothing;
