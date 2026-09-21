import { pool } from "@/lib/db";

// D단계 — 영상 5편의 분석을 모아 "그래서 뭘 만들어야 하나" 한 장으로 만든다.
//
// video_analysis는 영상 1편 단위고, 여기 결과는 키워드 단위다(9장).
// 화면에 나가는 건 개별 영상이 아니라 이 종합이다(8장).
//
// 왜 Qwen3-VL이 아니라 OpenAI인가:
// [02-INFRA 2장](../../docs/saas/02-INFRA.md)이 "2층 = 긴 자연어 생성 = 제품 가치 → API 유지"로
// 이미 정해둔 원칙이다. 게다가 "5편 중 4편" 같은 개수 세기는 4B 모델이 약하다.

const MODEL = "gpt-4.1-mini";

const SCHEMA = {
  type: "object",
  properties: {
    empty_gap: { type: "string" },
    thumbnail_pattern: { type: "string" },
    hook_pattern: { type: "string" },
    title_candidates: { type: "array", items: { type: "string" } },
  },
  required: ["empty_gap", "thumbnail_pattern", "hook_pattern", "title_candidates"],
  additionalProperties: false,
};

const SYSTEM = `한국인 크리에이터가 영어권 유튜브 숏츠를 만들도록 돕는다.
같은 키워드로 터진 영상 여러 편의 분석을 받아, "그래서 뭘 만들어야 하나"를 정리한다.

★ 언어 규칙 (가장 중요)
- empty_gap · thumbnail_pattern · hook_pattern은 **반드시 한국어 문장**으로 쓴다.
  입력 자료가 영어여도 한국어로 답한다. 영어로 쓰면 안 된다.
- title_candidates만 영어로 쓴다 (영어권 시청자용 제목이므로).

내용 규칙:
- 패턴에는 반드시 숫자를 붙인다. "얼굴 클로즈업이 좋다"가 아니라 "5편 중 4편이 얼굴 클로즈업".
  근거가 되는 영상 수를 세어서 쓴다. 지어내지 않는다.
- empty_gap은 "이 영상들이 공통으로 다루지 않은 것" 중 한국인이 답할 수 있는 지점을 고른다.
  ★ 자막(transcript)에 무엇이 있었는지가 아니라 **무엇이 없었는지**를 보라.
  영상들이 전부 "무엇을"까지만 말하고 "왜"를 안 다뤘다면 그게 빈 구멍이다.
  성분 원리·한국 현지 사정·가격 차이·피부 타입별 차이처럼 흔히 비는 축을 먼저 확인하라.
  그래도 근거가 없을 때만 "표본에서 판단할 수 없음"이라고 쓴다. 이 답은 최후의 수단이다.
- thumbnail_pattern에는 **실제로 쓰인 글자 문구**와 색·위치·크기 같은 값을 넣는다.
  폰트 이름은 자료에 없으니 추측해서 쓰지 마라.
- hook_pattern에는 ★ **first_lines(실제 첫 대사)를 반드시 인용**하라.
  "직접적으로 시작한다" 같은 뭉뚱그린 말 대신 "5편 중 3편이 'Trust me' 같은 단언으로 연다"처럼
  실제 문장을 근거로 든다. 화면 자막(on_screen_text)이 있으면 그것도 같이 든다.
- title_candidates는 영어 제목 3개. 실제 영상들의 제목 문법을 따르되 베끼지 않는다.
- 자료가 비어 있는 항목은 정직하게 "자료 없음"이라고 쓴다.`;

export type Synthesis = {
  empty_gap: string;
  thumbnail_pattern: string;
  hook_pattern: string;
  title_candidates: string[];
};

// 자막에서 첫 문장 몇 개를 뽑는다. "인사말이냐 본론이냐" 같은 이진 구분보다
// 실제로 뭐라고 말문을 열었는지가 대본을 쓸 때 훨씬 쓸모 있다(2026-08-28).
// 자막은 이미 DB에 있으므로 추가 호출이 없다.
export function firstLines(transcript: string | null, n = 3): string[] {
  if (!transcript) return [];
  return transcript
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, n);
}

export async function synthesizeKeyword(keywordId: number): Promise<Synthesis | null> {
  const { rows } = await pool.query(
    `select c.title, c.channel_title, c.views, c.outlier, c.duration_sec,
            c.like_count, c.outlier_confidence,
            a.transcript, a.thumb_desc, a.hook_desc
       from video_candidates c
       join video_analysis a on a.video_pk = c.id
      where c.keyword_id = $1 and c.picked
      order by c.outlier desc nulls last`,
    [keywordId]
  );
  if (!rows.length) return null;

  const { rows: [kw] } = await pool.query(
    `select keyword, reason from video_keywords where id = $1`, [keywordId]
  );

  const payload = {
    keyword: kw?.keyword,
    search_query: kw?.reason?.search_query ?? kw?.keyword,
    video_count: rows.length,
    videos: rows.map((r, i) => ({
      n: i + 1,
      title: r.title,
      channel: r.channel_title,
      outlier: r.outlier,
      // 배율을 못 믿는 경우를 표시한다. 분모가 작거나 채널이 양봉분포인 것들이다.
      outlier_confidence: r.outlier_confidence,
      // 참여율. 조회수는 돈으로 사도 좋아요 비율은 못 산다 — 유료 노출을 가려낸다.
      like_rate: r.like_count && Number(r.views)
        ? `${((Number(r.like_count) / Number(r.views)) * 100).toFixed(2)}%` : null,
      duration_sec: r.duration_sec,
      // 말문을 어떻게 열었는지. hook_pattern에서 이걸 근거로 쓴다.
      first_lines: firstLines(r.transcript),
      transcript: r.transcript,
      thumbnail: r.thumb_desc,
      hook: r.hook_desc,
    })),
  };

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: `영상 ${rows.length}편의 분석이다. 종합하라.\n${JSON.stringify(payload, null, 1)}` },
      ],
      response_format: { type: "json_schema", json_schema: { name: "synthesis", strict: true, schema: SCHEMA } },
      temperature: 0.3,
    }),
  });
  if (!res.ok) throw new Error(`openai ${res.status}: ${(await res.text()).slice(0, 200)}`);

  const s: Synthesis = JSON.parse((await res.json()).choices[0].message.content);

  await pool.query(
    `insert into video_keyword_analysis
       (keyword_id, empty_gap, thumbnail_pattern, hook_pattern, title_candidates, analyzed_at)
     values ($1,$2,$3,$4,$5, now())
     on conflict (keyword_id) do update set
       empty_gap = excluded.empty_gap, thumbnail_pattern = excluded.thumbnail_pattern,
       hook_pattern = excluded.hook_pattern, title_candidates = excluded.title_candidates,
       analyzed_at = excluded.analyzed_at`,
    [keywordId, s.empty_gap, s.thumbnail_pattern, s.hook_pattern, s.title_candidates]
  );
  return s;
}
