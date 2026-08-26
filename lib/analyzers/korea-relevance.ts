import { pool } from "@/lib/db";

// LLM이 판단하는 것은 이제 두 가지뿐이다.
//   1) kr_relevance (0~10) — 점수의 20점을 담당
//   2) misconception — 점수에는 안 들어가고, 글감 재료로만 쓴다
//
// misconception을 별도 필드로 뺀 이유:
// 예전엔 awareness 5지선다에 '오해'를 섞어뒀는데 100건 중 0건이 나왔다.
// "아는 양"(정확히앎↔처음들음)과 "아는 내용의 정확성"(오해)은 다른 축인데 하나만 고르게 했고,
// 브랜드를 잘 아는 사람은 오해가 있어도 '정확히앎'으로 갔다.
// what/correction을 반드시 쓰게 하면 회피가 어려워지고, 그 두 문장이 그대로 글감이 된다.

const MODEL = "gpt-4.1-mini";
const BATCH = 10;
const BODY_LIMIT = 1200;

const SYSTEM = `너는 한국 뷰티 콘텐츠 팀의 리서치 분석가다.
영어권 레딧 글을 읽고 두 가지만 판단한다. 점수를 매기지 마라 — 재료만 뽑는다.

■ kr_relevance (0~10) — 한국이 이 글의 중심인가
- 9~10 한국 제품·시술·클리닉·쇼핑이 글의 주제 자체다
- 6~8  한국 브랜드나 시술이 등장하고 논의의 한 축이다
- 3~5  한국 것이 스쳐 지나가듯 언급된다
- 0~2  한국과 무관하다

판단 기준은 "한국인이라야 답할 수 있는가"다.
"CeraVe 보습제 추천해줘"는 한국과 무관하다(0~2).
"올리브영에서 뭘 사야 하나"는 한국이 중심이다(9~10).

■ misconception — 글쓴이가 한국 뷰티에 대해 잘못 알고 있는 것이 있나
- has: 명백히 사실과 다른 믿음이 드러날 때만 true. 취향·선호는 오해가 아니다.
- what: 무엇을 잘못 알고 있는지 한 문장. has=true면 반드시 채운다.
- correction: 실제로는 어떤지 한 문장. 한국 사정을 아는 사람 기준으로. has=true면 반드시 채운다.

has=false면 what과 correction은 빈 문자열로 둔다.
확신이 없으면 has=false로 둬라. 억지로 만들지 마라.`;

const SCHEMA = {
  type: "object",
  properties: {
    results: {
      type: "array",
      items: {
        type: "object",
        properties: {
          idx: { type: "integer" },
          kr_relevance: { type: "integer" },
          misconception: {
            type: "object",
            properties: {
              has: { type: "boolean" },
              what: { type: "string" },
              correction: { type: "string" },
            },
            required: ["has", "what", "correction"],
            additionalProperties: false,
          },
        },
        required: ["idx", "kr_relevance", "misconception"],
        additionalProperties: false,
      },
    },
  },
  required: ["results"],
  additionalProperties: false,
} as const;

type Row = { mention_id: string; title: string; body: string | null; topic: string };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function call(rows: Row[], tries = 3) {
  const payload = rows.map((r, i) => ({
    idx: i, title: r.title, topic: r.topic, body: (r.body ?? "").slice(0, BODY_LIMIT),
  }));
  for (let t = 0; t < tries; t++) {
    try {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
        body: JSON.stringify({
          model: MODEL,
          messages: [
            { role: "system", content: SYSTEM },
            { role: "user", content: `다음 ${rows.length}건을 판단해라.\n\n${JSON.stringify(payload, null, 1)}` },
          ],
          response_format: { type: "json_schema", json_schema: { name: "relevance", strict: true, schema: SCHEMA } },
          temperature: 0.1,
        }),
      });
      if (!res.ok) throw new Error(`openai ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const d = await res.json();
      return { results: JSON.parse(d.choices[0].message.content).results as any[], usage: d.usage };
    } catch (err) {
      if (t === tries - 1) throw err;
      await sleep(3000 * (t + 1));
    }
  }
  throw new Error("unreachable");
}

export type RelevanceResult = {
  targets: number; done: number; failed: number; misconceptions: number;
  prompt_tokens: number; completion_tokens: number; errors: string[];
};

export async function extractRelevance(limit = 200, force = false): Promise<RelevanceResult> {
  const rows = (await pool.query<Row>(
    `select a.mention_id, m.title, m.raw->>'body' as body, a.topic
       from post_analysis a join mentions m on m.id = a.mention_id
      ${force ? "" : "where a.kr_relevance is null"}
      order by a.mention_id limit $1`,
    [limit]
  )).rows;

  const out: RelevanceResult = {
    targets: rows.length, done: 0, failed: 0, misconceptions: 0,
    prompt_tokens: 0, completion_tokens: 0, errors: [],
  };

  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    try {
      if (i > 0) await sleep(1200);
      const { results, usage } = await call(batch);
      out.prompt_tokens += usage?.prompt_tokens ?? 0;
      out.completion_tokens += usage?.completion_tokens ?? 0;
      for (const r of results) {
        const row = batch[r.idx];
        if (!row) continue;
        const mc = r.misconception ?? { has: false, what: "", correction: "" };
        await pool.query(
          `update post_analysis set kr_relevance = $2, misconception = $3 where mention_id = $1`,
          [row.mention_id, Math.max(0, Math.min(10, r.kr_relevance ?? 0)), JSON.stringify(mc)]
        );
        if (mc.has) out.misconceptions++;
        out.done++;
      }
    } catch (err) {
      out.failed += batch.length;
      out.errors.push(`배치 ${Math.floor(i / BATCH) + 1}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return out;
}
