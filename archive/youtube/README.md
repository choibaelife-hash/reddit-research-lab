# YouTube 기능 보관본

2026-09-21에 YouTube 수집·분석 기능을 활성 앱에서 분리했다. 코드는 삭제하지 않았고 이 폴더에 원래 구조를 최대한 유지해 보관한다.

## 현재 상태

- 앱 메뉴와 `/board` 렌더링에서 제외됨
- `/api/cron/video`, `/api/cron/video-analyze` 라우트는 활성 경로에서 제외됨
- 정기 크론은 Reddit/RSS 파이프라인만 실행함
- Docker 이미지에 `yt-dlp`, `ffmpeg`, Python을 설치하지 않음
- `schema-video.sql`은 기본 스키마 적용 대상에서 제외됨
- 기존 Supabase의 `video_*` 테이블과 데이터는 삭제하지 않음
- `archive/`는 TypeScript 컴파일 대상에서 제외됨

## 보관된 원래 구성

- `components/VideoTab.tsx`: 유튜브 보드 화면
- `components/video.css`: 유튜브 화면 전용 스타일
- `app/api/cron/video/route.ts`: 후보 영상 수집 진입점
- `app/api/cron/video-analyze/route.ts`: 영상 분석 진입점
- `lib/video/`: 키워드, YouTube API, 분석, 종합 로직
- `ml/whisper_server.py`: 로컬 Whisper 보조 서버
- `schema-video.sql`: 유튜브 테이블 스키마
- `scripts/backfill-run.mjs`: 유튜브를 포함한 과거 run 보정 스크립트
- `Dockerfile.youtube`: 분리 전 Railway 이미지 설정

## 다시 활성화할 때

1. 이 폴더의 파일을 위 원래 경로로 되돌린다.
2. `VideoTab` import, 유튜브 탭, 상세 렌더링과 CSS를 다시 연결한다.
3. `scripts/cron.mjs`에 두 유튜브 엔드포인트를 명시적으로 복구한다.
4. `scripts/apply-schema.mjs`와 Dockerfile에 `schema-video.sql`을 복구한다.
5. `YOUTUBE_API_KEY`, OpenAI/VLM 설정, `YTDLP_BIN`, `FFMPEG_BIN`, 선택적으로 `WHISPER_URL`을 설정한다.
6. 별도 테스트 환경에서 수집과 분석을 각각 검증한 뒤 배포한다.

활성 앱과 다시 합칠 때는 보관본을 그대로 복사하기보다 최신 DB 구조와 워크스페이스 격리 방식에 맞게 먼저 수정해야 한다.
