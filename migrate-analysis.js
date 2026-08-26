import { pool } from "./db.js";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL이 없습니다. .env.local을 확인하세요.");
  process.exit(1);
}

// 원본(mentions)은 건드리지 않는다. 재분석해도 원본이 망가지지 않도록 분석 결과만 따로 쌓는다.

// ── 1층: 글 한 건에 대한 분류 결과 ──────────────────────────────
await pool.query(`
create table if not exists post_analysis (
  mention_id   uuid primary key references mentions(id) on delete cascade,
  category     text,          -- products | treatments | stay | where-to-go (글 내용 기준 재분류)
  post_type    text,          -- 방문계획 | 병원시술추천요청 | 시술후기 | 제품추천요청 | 제품후기비교 | 우려안전성 | 경고이슈 | 일반고민
  topic        text,          -- 정규화된 주제 (같은 주제끼리 묶는 열쇠)
  topic_en     text,
  summary_ko   text,          -- 한국어 한 줄
  awareness    text,          -- 정확히앎 | 대충앎 | 오해 | 처음들음
  worth        smallint,      -- 소재 가치 0~100 (2층으로 올릴지 결정)
  layer        smallint not null default 1,
  model        text,
  analyzed_at  timestamptz not null default now()
)`);
await pool.query(`create index if not exists post_analysis_topic_idx on post_analysis (topic)`);
await pool.query(`create index if not exists post_analysis_worth_idx on post_analysis (worth desc)`);
console.log("✔ post_analysis");

// ── 실체(엔티티): 주마다 누적되는 자산. 나중 플랫폼의 병원·시술·제품 DB가 된다 ──
await pool.query(`
create table if not exists entities (
  id             uuid primary key default gen_random_uuid(),
  kind           text not null check (kind in
                   ('clinic','treatment','product','brand','place','ingredient','channel')),
  canonical_name text not null,
  name_ko        text,
  aliases        text[] not null default '{}',
  meta           jsonb  not null default '{}'::jsonb,
  first_seen_at  timestamptz not null default now(),
  unique (kind, canonical_name)
)`);
console.log("✔ entities");

// role을 PK에 넣어야 "같은 병원을 본문에선 문의, 댓글에선 추천"을 따로 기록할 수 있다.
// PK 컬럼은 null이면 안 되므로 not null default ''로 둔다.
await pool.query(`
create table if not exists entity_mentions (
  entity_id   uuid not null references entities(id) on delete cascade,
  mention_id  uuid not null references mentions(id) on delete cascade,
  source_kind text not null default 'post' check (source_kind in ('post','comment')),
  role        text not null default '',   -- recommended | asked_about | reviewed | warned_against | used
  sentiment   text,                        -- positive | negative | mixed | neutral
  quote       text,                        -- 근거가 된 원문 한 줄
  created_at  timestamptz not null default now(),
  primary key (entity_id, mention_id, source_kind, role)
)`);
await pool.query(`create index if not exists entity_mentions_mention_idx on entity_mentions (mention_id)`);
console.log("✔ entity_mentions");

// ── 방문객 수요 프로필: 나중 코스 설계 서비스의 원료 ──────────────
await pool.query(`
create table if not exists demand_signals (
  mention_id     uuid primary key references mentions(id) on delete cascade,
  age_band       text,
  origin         text,       -- 어디서 오는지
  budget         text,
  stay_duration  text,       -- "36시간" 같은 체류 기간
  goals          text[] not null default '{}',
  constraints    text[] not null default '{}',   -- 다운타임 없어야 / 주사 제외 등
  concerns       text[] not null default '{}',   -- 마취 안전성 / 언어 등
  extracted_at   timestamptz not null default now()
)`);
console.log("✔ demand_signals");

// ── 댓글 저장 (글당 상위 5개) ─────────────────────────────────
await pool.query(`
create table if not exists post_comments (
  mention_id  uuid not null references mentions(id) on delete cascade,
  rank        smallint not null,          -- sort=top 순서
  author      text,
  body        text not null,
  body_ko     text,                       -- 한국어 번역/요약 (2층)
  fetched_at  timestamptz not null default now(),
  primary key (mention_id, rank)
)`);
console.log("✔ post_comments");

// ── 소재 재고: 담기·메모·상태 ────────────────────────────────
await pool.query(`
create table if not exists idea_cards (
  mention_id   uuid primary key references mentions(id) on delete cascade,
  angles       jsonb not null default '[]'::jsonb,   -- [{ko,en,guide}]
  gap          text,                                  -- 정보 격차
  detail       jsonb not null default '{}'::jsonb,    -- 유형별 전용 추출
  status       text not null default 'candidate'
               check (status in ('candidate','saved','published','held','dropped')),
  note         text,                                  -- 경민님 메모
  saved_at     timestamptz,
  published_at timestamptz,
  updated_at   timestamptz not null default now()
)`);
console.log("✔ idea_cards");

await pool.end();
console.log("\n분석용 테이블 6개 준비 완료 — mentions/keywords 원본은 그대로입니다.");
