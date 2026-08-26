-- docs/05-dashboard-master-spec.md §9.2 그대로. 스키마를 바꿀 땐 그 문서를 먼저 고치고 여기 반영할 것.

-- ── 관측 축 ─────────────────────────────────────────
create table keywords (
  id            uuid primary key default gen_random_uuid(),
  label         text not null,
  summary       text,
  category      text not null check (category in ('products','treatments','stay','where-to-go')),
  status        text not null default 'observing'
                check (status in ('candidate','observing','archived')),
  first_seen_at timestamptz not null default now(),
  promoted_at   timestamptz,          -- 사람이 승격한 시점
  merged_into   uuid references keywords(id),  -- 병합된 경우 대표 키워드
  created_by    text default 'auto',  -- auto | manual
  updated_at    timestamptz not null default now()
);
create index on keywords (category, status);

-- 원본 언급 (1년 보관)
create table mentions (
  id            uuid primary key default gen_random_uuid(),
  keyword_id    uuid not null references keywords(id) on delete cascade,
  source        text not null check (source in ('reddit','rss','trends','gsc','instagram','oliveyoung','babitalk','klook','agoda','manual')),
  external_id   text not null,        -- 레딧 post id, 기사 URL 등
  url           text,
  title         text,
  raw           jsonb default '{}'::jsonb,   -- upvotes, comments, rank 등 원자료
  occurred_at   timestamptz not null,
  collected_at  timestamptz not null default now(),
  unique (source, external_id)        -- ★ 중복 실행 방어의 핵심
);
create index on mentions (keyword_id, occurred_at desc);

-- 일별 집계 (영구 보관)
create table keyword_daily (
  keyword_id       uuid not null references keywords(id) on delete cascade,
  day              date not null,
  reddit_posts     int  default 0,
  reddit_score     int  default 0,
  reddit_comments  int  default 0,
  rss_articles     int  default 0,
  trends_kr        smallint,
  trends_us        smallint,
  gap              smallint generated always as (coalesce(trends_kr,0) - coalesce(trends_us,0)) stored,
  ig_trend         text,              -- up | flat | down
  extra            jsonb default '{}'::jsonb,  -- 카테고리 전용 지표
  primary key (keyword_id, day)
);

-- 계산된 점수 (재계산 가능)
create table keyword_scores (
  keyword_id     uuid primary key references keywords(id) on delete cascade,
  buzz           smallint,   -- 화제성 (최우선 가중치)
  gap_score      smallint,   -- 격차 (절대값 기준)
  competition    smallint,   -- 낮을수록 좋음
  monetizable    smallint,   -- 제휴처 검색 결과
  total          smallint,
  sources_used   text[],     -- 계산에 쓰인 소스 (죽은 소스 제외)
  computed_at    timestamptz not null default now()
);

-- ── 제작 축 ─────────────────────────────────────────
create table ideas (                       -- 소재 = 키워드 묶음
  id             uuid primary key default gen_random_uuid(),
  title          text,
  category       text not null,
  format         text check (format in ('topn','deep','compare','faq')),
  angle_note     text,                     -- 각도·관점 메모
  local_comment  text,                     -- 현지인 코멘트
  status         text not null default 'selected'
                 check (status in ('selected','drafting','review','published','rejected')),
  channels       text[] default '{}',      -- 승인 시 선택한 채널
  sanity_post_id text,
  revision_count smallint not null default 0,
  selected_at    timestamptz not null default now(),
  published_at   timestamptz,
  updated_at     timestamptz not null default now()
);

create table idea_keywords (               -- 소재 ↔ 키워드 N:M
  idea_id    uuid not null references ideas(id) on delete cascade,
  keyword_id uuid not null references keywords(id) on delete cascade,
  rank       smallint,                     -- TOP N 순위
  primary key (idea_id, keyword_id)
);

create table channel_outputs (
  id           uuid primary key default gen_random_uuid(),
  idea_id      uuid not null references ideas(id) on delete cascade,
  channel      text not null check (channel in ('web','pinterest','instagram','tiktok','naver','tistory')),
  body         text,
  seo          jsonb default '{}'::jsonb,  -- web 전용: focus_keyphrase, meta_*, faq[], schema_org_type
  image_candidates jsonb default '[]'::jsonb,
  image_url    text,                       -- 사람이 택1한 결과
  status       text not null default 'pending'
               check (status in ('pending','generated','approved','posted','skipped','failed')),
  posted_at    timestamptz,
  updated_at   timestamptz not null default now(),
  unique (idea_id, channel)
);

create table revisions (
  id         uuid primary key default gen_random_uuid(),
  idea_id    uuid not null references ideas(id) on delete cascade,
  seq        smallint not null,
  feedback   text not null,
  created_at timestamptz not null default now(),
  unique (idea_id, seq)
);

create table affiliate_links (
  id             uuid primary key default gen_random_uuid(),
  idea_id        uuid references ideas(id) on delete set null,
  sanity_post_id text,
  program        text not null,
  product_name   text,
  url            text not null,
  added_at       timestamptz not null default now()
);

-- ── 운영 축 ─────────────────────────────────────────
create table source_status (
  source            text not null,
  category          text not null default 'products',  -- 주제(K-beauty/Stay/Where to go)별 이력 분리용
  last_success_at   timestamptz,
  last_attempt_at   timestamptz,
  last_count        int,
  consecutive_fails smallint not null default 0,
  state             text not null default 'ok'
                    check (state in ('ok','degraded','down')),
  note              text,
  primary key (source, category)
);

create table collection_rules (            -- 대시보드에서 편집 (키워드·소스 추가삭제)
  id        uuid primary key default gen_random_uuid(),
  category  text not null,
  source    text not null,
  value     text not null,                 -- 키워드 / 서브레딧 / RSS URL / 계정 ID / 해시태그
  enabled   boolean not null default true,
  options   jsonb not null default '{}'::jsonb,  -- 소스별 설정. reddit: {"period":"week"|"month"}
  created_at timestamptz not null default now(),
  unique (category, source, value)
);

create table jobs (
  id               uuid primary key default gen_random_uuid(),
  idea_id          uuid references ideas(id) on delete cascade,
  kind             text not null check (kind in ('write_body','convert_channels','generate_images')),
  channel          text,                   -- 채널 단위 재시도용
  status           text not null default 'queued'
                   check (status in ('queued','running','done','failed')),
  n8n_execution_id text,
  error            text,
  requested_at     timestamptz not null default now(),
  finished_at      timestamptz
);

create table title_excludes (              -- 대시보드에서 편집 (정기 게시판 등 제목 기반 제외 단어)
  id         uuid primary key default gen_random_uuid(),
  value      text not null unique,
  enabled    boolean not null default true,
  created_at timestamptz not null default now()
);

-- docs/instagram_apify.md 기준 (관측 보드와 별개 서브시스템, /admin/instagram)
create table instagram_watchlist (
  username  text primary key,
  active    boolean not null default true,
  added_at  timestamptz not null default now(),
  language  text check (language in ('ko','en','other'))
);

create table instagram_mentions (
  external_post_id       text primary key,
  account_username       text not null,
  post_url               text not null,
  post_type              text not null check (post_type in ('image','video','carousel','reel')),
  caption_raw             text,
  posted_at               timestamptz not null,
  collected_at            timestamptz not null default now(),
  likes_count             int,
  comments_count          int,
  is_informational        boolean,
  category                text check (category in ('ingredient_expert','treatment','product_info','deal_event')),
  summary                 text,
  hashtags                text[],
  is_comment_bait         boolean,
  comment_trigger_phrase  text,
  carousel_slide_count    int,
  image_urls              text[],
  vision_used             boolean,
  long_summary            text,
  manually_approved       boolean not null default false,
  comment_text_posted     text,
  comment_scheduled_at    timestamptz,
  comment_posted_at       timestamptz,
  comment_status          text check (comment_status in ('scheduled','posted','failed')),
  comment_failure_reason  text,
  status                  text not null default 'new'
                          check (status in ('new','daily_life','not_applicable','comment_scheduled','comment_posted','info_received'))
);
create index on instagram_mentions (account_username, posted_at desc);

create table instagram_pipeline_runs (
  id              uuid primary key default gen_random_uuid(),
  run_type        text not null check (run_type in ('sync','collect','analyze')),
  started_at      timestamptz not null default now(),
  finished_at     timestamptz,
  result_summary  text,
  error           text
);

create table instagram_dm_captures (
  id                       uuid primary key default gen_random_uuid(),
  mention_external_post_id text not null references instagram_mentions(external_post_id) on delete cascade,
  message_text_raw         text not null,
  message_type             text check (message_type in ('info','follow_confirm','other')),
  received_at              timestamptz not null default now(),
  requires_action          boolean not null default false,
  action_taken             boolean not null default false,
  action_taken_at          timestamptz,
  extracted_info           text
);

-- 미분석 검토 게시물 중, 댓글이 빠르게 몰리는 것들은 LLM 분석 결과와 무관하게
-- 워치리스트 콘텐츠로 자동 이동시키는 기준값(단일 행, 대시보드에서 직접 수정 가능)
create table instagram_auto_approve_settings (
  id                      boolean primary key default true check (id),
  daily_comment_rate      int not null default 100,
  early_window_hours      int not null default 6,
  early_window_comments   int not null default 50
);
