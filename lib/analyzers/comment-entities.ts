import { pool } from "@/lib/db";

// 댓글 전용 엔티티 추출.
// 1층(classify.ts)은 글 "본문"만 본다. 그런데 병원·클리닉 이름은 본문이 아니라 거의 전부 댓글에 나온다
// (본문은 "서울에서 병원 추천해줘", 댓글이 "OO의원 가봐"). 그래서 댓글을 따로 훑는다.
//
// 나중에 "귀 병원이 해외 커뮤니티에서 N번 언급됐습니다"라는 근거로 쓰려면 원문 인용이 필요해서
// quote를 반드시 함께 저장한다.

const MODEL = "gpt-4.1-mini";
const BATCH = 6;          // 글 단위 배치 (글 하나당 댓글 5개)
const COMMENT_LIMIT = 420;

export const ENTITY_KINDS = ["clinic", "treatment", "product", "brand", "place", "channel"] as const;

const SYSTEM = `너는 한국 뷰티 리서치 분석가다.
영어권 레딧 "댓글"에서 실제로 언급된 고유명사를 뽑는다.

■ 무엇을 뽑나
- clinic: 병원·의원·클리닉 이름 (예: "Seoul Sy", "Banobagi", "이대저널피부과")
- place: 스파·경락샵·매장·지역 (예: "Olive Young Myeongdong", "Gangnam")
- treatment: 시술명 (예: "Ultherapy", "Rejuran", "aqua peel")
- product: 구체적 제품명 (예: "Beauty of Joseon Relief Sun")
- brand: 브랜드명 (예: "COSRX")
- channel: 구매처·플랫폼 (예: "YesStyle", "Stylevana", "Global Olive Young")

■ 절대 규칙
- 댓글에 **실제로 적힌 것만** 뽑는다. 추측하거나 일반 지식으로 채우지 마라.
- 하나도 없으면 빈 배열을 반환한다. 억지로 채우지 마라.
- quote에는 그 이름이 나온 **댓글 원문 한 조각(최대 120자)**을 그대로 넣는다. 요약하지 마라.
- canonical_name은 댓글에 적힌 표기 그대로. name_ko는 한국 정식 명칭을 확실히 알 때만, 모르면 null.
- 일반명사(sunscreen, moisturizer, dermatologist)는 뽑지 않는다. 고유명사만.

■ role — 그 댓글에서 어떤 맥락으로 나왔나
- recommended: 추천한다 / 가보라 / 사라
- warned_against: 피하라 / 별로다
- reviewed: 써봤다·받아봤다 + 평가
- asked_about: 이것에 대해 되묻는다
- used: 그냥 쓰고 있다고 언급

■ sentiment: positive | negative | mixed | neutral`;

const SCHEMA = {
  type: "object",
  properties: {
    results: {
      type: "array",
      items: {
        type: "object",
        properties: {
          idx: { type: "integer" },
          entities: {
            type: "array",
            items: {
              type: "object",
              properties: {
                kind: { type: "string", enum: [...ENTITY_KINDS] },
                canonical_name: { type: "string" },
                name_ko: { type: ["string", "null"] },
                role: { type: "string", enum: ["recommended", "warned_against", "reviewed", "asked_about", "used"] },
                sentiment: { type: "string", enum: ["positive", "negative", "mixed", "neutral"] },
                quote: { type: "string" },
              },
              required: ["kind", "canonical_name", "name_ko", "role", "sentiment", "quote"],
              additionalProperties: false,
            },
          },
        },
        required: ["idx", "entities"],
        additionalProperties: false,
      },
    },
  },
  required: ["results"],
  additionalProperties: false,
} as const;

type Row = { mention_id: string; title: string; area: string; comments: string[] };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function callOpenAI(rows: Row[], tries = 3) {
  const payload = rows.map((r, i) => ({
    idx: i,
    post_title: r.title,
    beauty_area: r.area,
    comments: r.comments.map((c) => c.slice(0, COMMENT_LIMIT)),
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
            { role: "user", content: `다음 ${rows.length}개 글의 댓글에서 고유명사를 뽑아라.\n\n${JSON.stringify(payload, null, 1)}` },
          ],
          response_format: { type: "json_schema", json_schema: { name: "comment_entities", strict: true, schema: SCHEMA } },
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

export type CommentEntityResult = {
  targets: number; done: number; failed: number; entities: number; clinics: number;
  prompt_tokens: number; completion_tokens: number; errors: string[];
};

export async function extractCommentEntities(limit = 60): Promise<CommentEntityResult> {
  // 댓글이 있고 아직 시도하지 않은 글만.
  //
  // 조건을 "실체 행이 없으면 안 한 것"으로 두면 안 된다.
  // 댓글이 "고마워요" 같은 공감글뿐이라 뽑을 이름이 하나도 없는 글이 있는데(실측 72건 중 7건),
  // 그런 글은 처리해도 행이 안 생겨서 영원히 "안 한 것"으로 남는다. 실제로 tick이 60번 반복했다.
  // → 결과가 0개여도 entities_checked_at을 남겨서 "해봤고 없었다"로 확정하고 버린다.
  const rows = (await pool.query<Row>(
    `select m.id as mention_id, m.title, a.beauty_area as area,
            array_agg(c.body order by c.rank) as comments
       from mentions m
       join post_analysis a on a.mention_id = m.id
       join post_comments c on c.mention_id = m.id
      where a.entities_checked_at is null
      group by m.id, m.title, a.beauty_area, a.worth
      order by (case when a.beauty_area = '시술클리닉' then 0 else 1 end), a.worth desc
      limit $1`,
    [limit]
  )).rows;

  const out: CommentEntityResult = {
    targets: rows.length, done: 0, failed: 0, entities: 0, clinics: 0,
    prompt_tokens: 0, completion_tokens: 0, errors: [],
  };

  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    try {
      if (i > 0) await sleep(1200);
      const { results, usage } = await callOpenAI(batch);
      out.prompt_tokens += usage?.prompt_tokens ?? 0;
      out.completion_tokens += usage?.completion_tokens ?? 0;

      for (const r of results) {
        const row = batch[r.idx];
        if (!row) continue;
        for (const e of r.entities ?? []) {
          const name = (e?.canonical_name ?? "").trim();
          if (!name || name.length > 90) continue;
          const ins = await pool.query<{ id: string }>(
            `insert into entities (kind, canonical_name, name_ko) values ($1,$2,$3)
             on conflict (kind, canonical_name) do update set
               name_ko = coalesce(entities.name_ko, excluded.name_ko)
             returning id`,
            [e.kind, name, e.name_ko || null]
          );
          await pool.query(
            `insert into entity_mentions (entity_id, mention_id, source_kind, role, sentiment, quote)
             values ($1,$2,'comment',$3,$4,$5)
             on conflict (entity_id, mention_id, source_kind, role) do nothing`,
            [ins.rows[0].id, row.mention_id, e.role ?? "", e.sentiment ?? null, (e.quote ?? "").slice(0, 300) || null]
          );
          out.entities++;
          if (e.kind === "clinic") out.clinics++;
        }
        // 0개여도 반드시 기록한다. 이게 없으면 무한 반복이다.
        await pool.query(
          `update post_analysis set entities_checked_at = now() where mention_id = $1`, [row.mention_id]);
        out.done++;
      }
    } catch (err) {
      out.failed += batch.length;
      out.errors.push(`배치 ${Math.floor(i / BATCH) + 1}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return out;
}
