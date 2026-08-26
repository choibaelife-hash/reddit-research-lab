import { pool } from "@/lib/db";

// 2층 — 1층에서 가치가 높게 나온 글에 댓글을 붙여 "발행할 콘텐츠 후보"를 만든다.
// 서브레딧당 3건씩 = 12장. 점수만으로 뽑으면 한 서브레딧에 쏠려서 카테고리 커버가 깨지므로 서브레딧별로 나눠 뽑는다.

const MODEL = "gpt-4.1";
const PER_SUB = 3;
const BODY_LIMIT = 2000;

const SYSTEM = `너는 한국 뷰티 콘텐츠 팀의 기획자다.
영어권 레딧 글과 그 인기 댓글을 읽고, 한국인 편집자가 바로 착수할 수 있는 콘텐츠 기획안을 만든다.

■ comments_ko — 댓글을 한국어로 옮긴다
- 원문 순서(인기순) 그대로 번호를 유지한다.
- 직역이 아니라 요점만. 한 댓글당 1~2문장.
- 누가 썼는지는 필요 없다. 무엇을 주장/추천했는지만 남긴다.
- 제품·병원·브랜드 이름은 원문 표기 그대로 유지한다.

■ gap — 정보 격차
이 글과 댓글이 드러내는 "영어권에 없고 한국인은 아는" 정보를 한 문장으로. 없으면 솔직히 없다고 써라.

■ angles — 발행할 콘텐츠 후보 2개
- ko: 한국어 제목. 실제 발행할 수 있는 구체적인 제목.
- en: 영어 제목. 번역이 아니라 영어권 독자에게 통할 제목.
- guide: 이 글을 어떻게 쓸지. 무엇을 자료로 준비하고, 어떤 구조로 쓰고, 어떤 톤을 지킬지.
  2~3문장으로 구체적으로. "잘 정리한다" 같은 공허한 말은 쓰지 마라.

■ detail — 글 유형에 따라 다르게 채운다. 해당 없으면 빈 배열/빈 문자열.
- 추천요청/비교질문: asked(원글이 요구한 조건), suggested(댓글에 나온 추천 이름들)
- 후기리뷰: subject(대상), verdict(평가 요약)
- 경고이슈: claim(주장), pushback(댓글의 반박)
- 경험공유: routine(공유된 루틴·과정의 핵심)

사실을 지어내지 마라. 원문과 댓글에 없는 제품명·수치·규정은 쓰지 않는다.
확인이 필요한 부분은 guide에 "확인 필요"라고 적어라.`;

const SCHEMA = {
  type: "object",
  properties: {
    comments_ko: { type: "array", items: { type: "string" } },
    gap: { type: "string" },
    angles: {
      type: "array",
      items: {
        type: "object",
        properties: { ko: { type: "string" }, en: { type: "string" }, guide: { type: "string" } },
        required: ["ko", "en", "guide"],
        additionalProperties: false,
      },
    },
    detail: {
      type: "object",
      properties: {
        asked: { type: "array", items: { type: "string" } },
        suggested: { type: "array", items: { type: "string" } },
        subject: { type: "string" },
        verdict: { type: "string" },
        claim: { type: "string" },
        pushback: { type: "string" },
        routine: { type: "array", items: { type: "string" } },
      },
      required: ["asked", "suggested", "subject", "verdict", "claim", "pushback", "routine"],
      additionalProperties: false,
    },
  },
  required: ["comments_ko", "gap", "angles", "detail"],
  additionalProperties: false,
} as const;

type Target = {
  id: string; title: string; body: string | null; subreddit: string;
  topic: string; post_type: string; worth: number; summary_ko: string;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function buildCard(t: Target, comments: { rank: number; body: string }[]) {
  const user = JSON.stringify({
    subreddit: t.subreddit,
    title: t.title,
    body: (t.body ?? "").slice(0, BODY_LIMIT),
    post_type: t.post_type,
    topic: t.topic,
    comments: comments.map((c) => ({ no: c.rank, text: c.body.slice(0, 500) })),
  }, null, 1);

  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
        body: JSON.stringify({
          model: MODEL,
          messages: [{ role: "system", content: SYSTEM }, { role: "user", content: user }],
          response_format: { type: "json_schema", json_schema: { name: "card", strict: true, schema: SCHEMA } },
          temperature: 0.4,
        }),
      });
      if (!res.ok) throw new Error(`openai ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const d = await res.json();
      return { card: JSON.parse(d.choices[0].message.content), usage: d.usage };
    } catch (err) {
      if (i === 2) throw err;
      await sleep(3000 * (i + 1));
    }
  }
  throw new Error("unreachable");
}

export type CardResult = {
  targets: number; done: number; failed: number;
  prompt_tokens: number; completion_tokens: number; errors: string[];
};

export async function buildCards(perSub = PER_SUB): Promise<CardResult> {
  // 서브레딧별로 가치 상위 N건. 이미 카드가 있는 글은 건너뛴다(= 재과금 없음).
  const targets = (await pool.query<Target>(
    `with ranked as (
       select m.id, m.title, m.raw->>'body' as body, m.raw->>'subreddit' as subreddit,
              a.topic, a.post_type, a.worth, a.summary_ko,
              row_number() over (partition by m.raw->>'subreddit' order by a.worth desc,
                                 (m.raw->>'rank')::int asc) as rn
         from mentions m
         join post_analysis a on a.mention_id = m.id
         left join idea_cards c on c.mention_id = m.id
        where c.mention_id is null
     )
     select id, title, body, subreddit, topic, post_type, worth, summary_ko
       from ranked where rn <= $1 order by worth desc`,
    [perSub]
  )).rows;

  const out: CardResult = { targets: targets.length, done: 0, failed: 0, prompt_tokens: 0, completion_tokens: 0, errors: [] };

  for (const [i, t] of targets.entries()) {
    if (i > 0) await sleep(1200);
    try {
      const comments = (await pool.query<{ rank: number; body: string }>(
        `select rank, body from post_comments where mention_id = $1 order by rank`, [t.id]
      )).rows;

      const { card, usage } = await buildCard(t, comments);
      out.prompt_tokens += usage?.prompt_tokens ?? 0;
      out.completion_tokens += usage?.completion_tokens ?? 0;

      await pool.query(
        `insert into idea_cards (mention_id, angles, gap, detail, status)
         values ($1,$2,$3,$4,'candidate')
         on conflict (mention_id) do update set
           angles=excluded.angles, gap=excluded.gap, detail=excluded.detail, updated_at=now()`,
        [t.id, JSON.stringify(card.angles ?? []), card.gap ?? null, JSON.stringify(card.detail ?? {})]
      );

      // 댓글 한국어본은 원문 옆에 같이 둔다 — 토글로 전환해서 보기 위함
      for (const [idx, ko] of (card.comments_ko ?? []).entries()) {
        await pool.query(`update post_comments set body_ko = $3 where mention_id = $1 and rank = $2`,
          [t.id, idx + 1, ko]);
      }
      await pool.query(`update post_analysis set layer = 2 where mention_id = $1`, [t.id]);
      out.done++;
    } catch (err) {
      out.failed++;
      out.errors.push(`${t.subreddit} "${t.title.slice(0, 30)}": ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return out;
}
