-- SaaS 운영 스키마 — 계정 · 워크스페이스 · 주간 실행 기록
-- 적용: npm run schema
--
-- schema.sql / schema-video.sql은 "무엇을 수집하고 분석했나"를 담는다.
-- 이 파일은 "누구 것이고 언제 돌린 거냐"만 담는다. 저 둘은 건드리지 않는다.
--
-- 핵심 결정(2026-08-30): 결과 테이블에 workspace_id와 week를 따로 붙이지 않는다.
-- runs 한 줄이 워크스페이스와 주차를 둘 다 들고 있으므로, 결과에는 run_id 하나면 된다.
-- 컬럼이 절반이고, 주차 히스토리와 고객 격리가 동시에 풀린다.
--
-- mentions · entities · entity_mentions · post_comments · demand_signals는
-- 전역 공유로 남긴다. 같은 서브레딧을 고객 수만큼 중복 수집하면 레딧이 429로 막는다(07-SAAS.md 1장).
--
-- 여러 번 실행해도 안전하다.

create table if not exists users (
  id            uuid primary key default gen_random_uuid(),
  email         text not null unique,
  password_hash text not null,            -- scrypt:N:소금:해시 (lib/password.mjs)
  name          text,
  created_at    timestamptz not null default now()
);

create table if not exists workspaces (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references users(id) on delete cascade,
  name        text not null,
  -- 이 워크스페이스가 어떤 관점으로 보는지 한 문장.
  -- 지금은 화면에 보여주기만 한다. 나중에 점수의 30점인 '한국 관련도'를
  -- 이 문장으로 일반화할 자리다(07-SAAS.md 3장).
  perspective text,
  created_at  timestamptz not null default now()
);
create index if not exists workspaces_user_idx on workspaces (user_id, created_at);

-- 주간 실행 1회 = 한 줄. 마이페이지의 '실행 기록'이 그대로 이 표다.
create table if not exists runs (
  id           bigserial primary key,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  week         date not null,                      -- 그 주 월요일
  kind         text not null check (kind in ('reddit','video')),
  status       text not null default 'running' check (status in ('running','done','failed')),
  -- 이번 주에 실제로 뭐가 얼마나 나갔나.
  -- jsonb로 두는 이유: 보여줄 항목이 아직 안 정해졌는데 지금 컬럼으로 못 박으면
  -- 항목이 바뀔 때마다 마이그레이션을 해야 한다. 굳으면 그때 컬럼으로 뺀다.
  --   reddit: {"posts":140,"cards":12,"steps":["classify","cards"]}
  --   video:  {"keywords":3,"videos":47,"quotaUnits":300,"quotaPct":3}
  stats        jsonb not null default '{}'::jsonb,
  error        text,
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  -- 크론은 한 주에 여러 번 깨어난다(lib/pipeline.ts의 상태 머신).
  -- 깨어날 때마다 새 줄을 만들면 기록이 지저분해지므로 주 1줄로 묶는다.
  unique (workspace_id, week, kind)
);
create index if not exists runs_ws_idx on runs (workspace_id, week desc);

-- 결과에 실행번호를 단다. 이 컬럼 하나가 '누구 것'과 '언제 것'을 동시에 해결한다.
-- on delete set null: 실행 기록을 지워도 분석 결과 자체는 남는다.
alter table post_analysis  add column if not exists run_id bigint references runs(id) on delete set null;
alter table idea_cards     add column if not exists run_id bigint references runs(id) on delete set null;
alter table video_keywords add column if not exists run_id bigint references runs(id) on delete set null;

create index if not exists post_analysis_run_idx  on post_analysis (run_id);
create index if not exists idea_cards_run_idx     on idea_cards (run_id);
create index if not exists video_keywords_run_idx on video_keywords (run_id);
