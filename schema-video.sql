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

-- 2026-08-28 추가. 전부 `videos?part=snippet,statistics`가 이미 주던 것을 안 읽고 버렸던 값이다.
-- 할당량은 메서드 호출당 과금이라 part를 늘려도 비용이 0이다.
alter table video_candidates add column if not exists like_count    bigint;
alter table video_candidates add column if not exists comment_count bigint;
alter table video_candidates add column if not exists description   text;
alter table video_candidates add column if not exists category_id   text;

-- 채널 최근 업로드의 최댓값. 중앙값만으로는 양봉분포를 못 본다(11장 #11).
alter table video_candidates add column if not exists channel_max   bigint;

-- 아웃라이어를 믿어도 되는지. 분모가 이상하면 배율이 폭발한다.
--   low: 채널 중앙값이 너무 작거나(표본 부족), 최댓값/중앙값 격차가 커서 중앙값이 대표성을 잃은 경우
alter table video_candidates add column if not exists outlier_confidence text;

-- 언어. relevanceLanguage=en은 힌트일 뿐이라 아랍어·스페인어·터키어 영상이 섞여 들어왔다.
-- 훅과 대사를 참고하려면 실제로 영어를 말하는 영상이어야 하므로 audio 쪽을 기준으로 거른다.
alter table video_candidates add column if not exists audio_language   text;
alter table video_candidates add column if not exists default_language text;

-- 2단계(GPU) 산출물, 영상 1편 단위.
create table if not exists video_analysis (
  video_pk     bigint      primary key references video_candidates(id) on delete cascade,
  transcript   text,                              -- Whisper. 자연어라 text가 맞다
  thumb_desc   jsonb,                             -- Qwen3-VL 썸네일 판독 {layout, subject, products, texts[]}
  hook_desc    jsonb,                             -- 첫 15초 {beats[], opening, subject_on_screen_at, closeup_at}
  guide        jsonb,                             -- 최종 제작 가이드
  analyzed_at  timestamptz
);

-- 처음엔 thumb_desc·hook_desc를 text로 잡았다가 jsonb로 바꿨다(2026-08-28).
-- text면 객체가 문자열로 한 겹 감싸져 저장돼(`"{\"layout\":...}"`) 화면에서 못 읽는다.
-- 이미 만들어진 DB를 위해 여기서 맞춰준다. 이미 jsonb면 무해하게 통과한다.
alter table video_analysis alter column thumb_desc type jsonb using thumb_desc::jsonb;
alter table video_analysis alter column hook_desc  type jsonb using hook_desc::jsonb;

create index if not exists video_candidates_week_idx   on video_candidates (week, outlier desc nulls last);
create index if not exists video_candidates_kw_idx     on video_candidates (keyword_id);

-- 2단계 종합(D단계): video_analysis는 영상 1편 단위고, 이건 그 키워드의 5편을 모아 비교한 결과다.
-- jsonb 한 덩어리 대신 필드로 나눈다 — 나중에 "빈 구멍에 X가 몇 번 나왔나" 같은 걸
-- 컬럼으로 바로 조회·집계할 수 있어야 하기 때문(2026-08-27 결정).
create table if not exists video_keyword_analysis (
  keyword_id        bigint      primary key references video_keywords(id) on delete cascade,
  empty_gap         text,                            -- 빈 구멍
  thumbnail_pattern text,                             -- "5편 중 4편이 클로즈업" 같은 요약
  hook_pattern      text,                             -- 첫 15초 공통 패턴
  title_candidates  text[],                           -- 제목 후보
  analyzed_at       timestamptz
);
