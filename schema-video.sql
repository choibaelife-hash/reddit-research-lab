-- 영상분석 기능 전용 스키마 (레딧 파이프라인과 분리)
-- 적용: psql "$DATABASE_URL" -f schema-video.sql
--
-- 왜 schema.sql에 안 넣나: schema.sql은 museofseoul 시절 정의가 남아 있어
-- 현재 코드가 쓰는 테이블(post_analysis, entities 등)과 이미 어긋나 있다.
-- 거기 얹으면 잔재가 더 얽힌다. 이 기능은 독립 파일로 둔다.

-- 주차별로 뽑은 검색 키워드. 왜 뽑혔는지 근거를 남긴다.
create table if not exists video_keywords (
  id          bigserial primary key,
  week        date        not null,              -- 그 주 월요일
  keyword     text        not null,              -- 유튜브에 넣을 검색어
  rank        int         not null,              -- 1~5
  score       numeric     not null,              -- 선정 점수
  reason      jsonb       not null default '{}', -- {freq, avg_worth, source: 'entity'|'topic'}
  created_at  timestamptz not null default now(),
  unique (week, keyword)
);

-- 유튜브에서 수집한 영상. 같은 영상이 여러 주에 걸릴 수 있어 (week, video_id) 유니크.
create table if not exists video_candidates (
  id            bigserial primary key,
  week          date        not null,
  keyword_id    bigint      not null references video_keywords(id) on delete cascade,
  video_id      text        not null,
  title         text        not null,
  channel_id    text        not null,
  channel_title text,
  published_at  timestamptz not null,
  duration_sec  int,                              -- 60 미만이면 쇼츠로 본다
  views         bigint      not null default 0,
  thumbnail_url text,
  -- 아웃라이어: 이 영상 조회수 ÷ 채널 최근 영상 조회수 중앙값.
  -- 조회수 그대로 쓰면 채널이 커서 잘 된 것과 소재가 좋아서 잘 된 것을 구분 못 한다.
  channel_median bigint,
  outlier       numeric,
  picked        boolean     not null default false, -- 상위 5개로 선별됐는가
  created_at    timestamptz not null default now(),
  unique (week, video_id)
);

-- 2단계(GPU) 산출물. 지금은 비어 있고 컬럼만 준비한다.
create table if not exists video_analysis (
  video_pk     bigint      primary key references video_candidates(id) on delete cascade,
  transcript   text,                              -- Whisper
  thumb_desc   text,                              -- Qwen3-VL 썸네일 판독
  hook_desc    text,                              -- 첫 15초 프레임 분석
  guide        jsonb,                             -- 최종 제작 가이드
  analyzed_at  timestamptz
);

create index if not exists video_candidates_week_idx   on video_candidates (week, outlier desc nulls last);
create index if not exists video_candidates_kw_idx     on video_candidates (keyword_id);
