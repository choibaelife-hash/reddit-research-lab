import { pool } from "@/lib/db";

// 브랜드·성분명이 흔한 영어 표현과 겹치면 유튜브 검색이 무관한 결과로 오염된다.
// 실측(2026-08-27): "The Ordinary"로 검색 → 축구·동기부여·영화예고편만 나오고 스킨케어 영상 0편(03-VIDEO.md 11장 #7).
// 레딧에서 그 이름이 실제 언급된 문장(맥락)을 LLM에 보여줘서 검색어를 구체화한다.

const MODEL = "gpt-4.1-mini";

const SCHEMA = {
  type: "object",
  properties: { query: { type: "string" } },
  required: ["query"],
  additionalProperties: false,
};

const SYSTEM = `한국 뷰티 유튜브 리서치를 돕는다. 입력된 키워드(브랜드·성분명)가 흔한 영어 표현과 겹쳐
유튜브 검색이 스포츠·영화 같은 무관한 결과로 오염될 수 있다. 레딧에서 이 키워드가 실제로 언급된 문장들을 보고,
스킨케어 맥락임이 분명해지는 영어 검색어를 3~6단어로 만들어라. 이미 충분히 구체적인 키워드는 그대로 반환해도 된다.`;

export async function getQuotes(keyword: string, limit = 5): Promise<string[]> {
  const r = await pool.query<{ quote: string }>(
    `select em.quote
       from entity_mentions em
       join entities e on e.id = em.entity_id
      where lower(e.canonical_name) = lower($1) and em.quote is not null and em.quote <> ''
      order by em.created_at desc
      limit $2`,
    [keyword, limit]
  );
  return [...new Set(r.rows.map((x) => x.quote))];
}

export async function refineSearchQuery(keyword: string, quotes: string[]) {
  if (!quotes.length) return { query: keyword, usage: null as any };

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: `키워드: "${keyword}"\n레딧 언급 문장:\n${quotes.map((q) => `- ${q}`).join("\n")}` },
      ],
      response_format: { type: "json_schema", json_schema: { name: "search_query", strict: true, schema: SCHEMA } },
      temperature: 0.2,
    }),
  });
  if (!res.ok) throw new Error(`openai ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const d = await res.json();
  const { query } = JSON.parse(d.choices[0].message.content);
  return { query: (query || keyword).trim(), usage: d.usage };
}
