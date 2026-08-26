import { pool } from "@/lib/db";

// 1층 — 수집된 글 전량을 분류한다.
// 목적이 둘이다: (1) 지금 콘텐츠 소재를 고르기 위한 유형·주제·가치 (2) 나중 플랫폼이 쓸 실체(엔티티) 누적.
// 그래서 출력에 topic/worth 같은 "지금 쓰는 것"과 entities/demand 같은 "나중 쓰는 것"이 함께 들어간다.

const MODEL = "gpt-4.1-mini";
const BATCH = 8;          // 한 번에 넣는 글 수 — 너무 크면 뒤쪽 글의 품질이 떨어진다
const BODY_LIMIT = 1400;   // 글당 본문 상한(자). 평균 870자라 대부분 안 잘린다

// 뷰티 영역 — 이 프로젝트는 뷰티만 다룬다. 숙박·장소는 범위 밖.
export const BEAUTY_AREAS = [
  "스킨케어루틴", "선케어", "트러블여드름", "안티에이징",
  "메이크업", "시술클리닉", "성분안전성", "기기디바이스", "바디헤어",
] as const;
export const POST_TYPES = [
  "추천요청", "비교질문", "후기리뷰", "경험공유",
  "진단도움", "경고이슈", "정보설명", "잡담",
] as const;
export const ENTITY_KINDS = ["clinic", "treatment", "product", "brand", "place", "ingredient", "channel"] as const;

const SYSTEM = `너는 한국 뷰티 콘텐츠 팀의 리서치 분석가다.
영어권 레딧 게시물을 읽고 한국인 편집자가 쓸 수 있도록 분류·요약한다.

■ beauty_area — 이 글이 다루는 뷰티 영역 (하나만)
- 스킨케어루틴: 클렌징·토너·세럼·보습, 루틴 구성
- 선케어: 자외선차단제
- 트러블여드름: 여드름·모공·블랙헤드·피부질환
- 안티에이징: 레티노이드·주름·탄력·볼륨
- 메이크업: 베이스·컬러 메이크업
- 시술클리닉: 보톡스·필러·레이저·병원 진료
- 성분안전성: 성분 논쟁·규제·부작용
- 기기디바이스: LED마스크·홈케어 기기
- 바디헤어: 바디케어·헤어케어

■ post_type — 글쓴이가 무엇을 하고 있는가 (하나만)
- 추천요청: 뭘 사야/받아야 할지 묻는다
- 비교질문: A와 B 중 어느 쪽이 나은지 묻는다
- 후기리뷰: 써봤다·받아봤다 + 평가를 낸다
- 경험공유: 자기 루틴이나 과정 전체를 공유한다 (평가보다 서사)
- 진단도움: 자기 피부 상태를 봐달라고 한다
- 경고이슈: 위험·문제를 알린다 (PSA)
- 정보설명: 지식·해설을 제공한다
- 잡담: 유머·가벼운 대화

반드시 위 8개 중 실제로 맞는 것을 고른다. 애매하면 글의 마지막 문장이 무엇을 요구하는지로 판단해라.
전부 같은 값으로 채우지 마라 — 서로 다른 글이면 유형도 대개 다르다.

■ awareness — 글쓴이가 한국 뷰티에 대해 아는 정도
- 정확히앎: 브랜드·성분·한국 사정을 구체적으로 안다
- 대충앎: 이름은 알지만 왜 좋은지는 모른다
- 오해: 잘못 알고 있다
- 처음들음: 기준 자체가 없다
- 해당없음: 한국 뷰티와 무관한 글

■ worth — 0~100. 한국인이 답할 수 있고 영어권에 정보가 없을수록 높다
- 80~100: 한국 제품·시술·클리닉에 대한 질문이나 오해. 한국인만 답할 수 있다
- 50~79: 한국 브랜드가 등장하지만 일반적인 스킨케어 논의
- 20~49: 한국과 약하게 연결된 일반 뷰티 화제
- 0~19: 개인 진단 요청, 유머, 잡담

■ 그 밖
- summary_ko: 한국어 2~3문장. 번역이 아니라 요약. 상황과 원하는 것이 드러나야 한다.
- topic: 같은 주제의 다른 글과 묶이도록 일반화한다. 제목을 그대로 쓰지 마라.
- entities: 글에 실제로 등장한 것만. 지어내지 마라. 없으면 빈 배열.
- demand: 한국 방문·구매 의사가 드러난 글에만. 아니면 null.`;

const SCHEMA = {
  type: "object",
  properties: {
    results: {
      type: "array",
      items: {
        type: "object",
        properties: {
          idx: { type: "integer" },
          beauty_area: { type: "string", enum: [...BEAUTY_AREAS] },
          post_type: { type: "string", enum: [...POST_TYPES] },
          topic: { type: "string" },
          topic_en: { type: "string" },
          summary_ko: { type: "string" },
          awareness: { type: "string", enum: ["정확히앎", "대충앎", "오해", "처음들음", "해당없음"] },
          worth: { type: "integer" },
          entities: {
            type: "array",
            items: {
              type: "object",
              properties: {
                kind: { type: "string", enum: [...ENTITY_KINDS] },
                canonical_name: { type: "string" },
                name_ko: { type: ["string", "null"] },
                role: { type: "string", enum: ["recommended", "asked_about", "reviewed", "warned_against", "used"] },
                sentiment: { type: "string", enum: ["positive", "negative", "mixed", "neutral"] },
                quote: { type: ["string", "null"] },
              },
              required: ["kind", "canonical_name", "name_ko", "role", "sentiment", "quote"],
              additionalProperties: false,
            },
          },
          demand: {
            type: ["object", "null"],
            properties: {
              age_band: { type: ["string", "null"] },
              origin: { type: ["string", "null"] },
              budget: { type: ["string", "null"] },
              stay_duration: { type: ["string", "null"] },
              goals: { type: "array", items: { type: "string" } },
              constraints: { type: "array", items: { type: "string" } },
              concerns: { type: "array", items: { type: "string" } },
            },
            required: ["age_band", "origin", "budget", "stay_duration", "goals", "constraints", "concerns"],
            additionalProperties: false,
          },
        },
        required: ["idx", "beauty_area", "post_type", "topic", "topic_en", "summary_ko",
                   "awareness", "worth", "entities", "demand"],
        additionalProperties: false,
      },
    },
  },
  required: ["results"],
  additionalProperties: false,
} as const;

type Row = { id: string; title: string; body: string | null; subreddit: string; rank: number };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// 배치를 쉬지 않고 연달아 던지면 fetch failed로 끊긴다(실측) — 간격 + 재시도
async function callWithRetry(rows: Row[], tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      return await callOpenAI(rows);
    } catch (err) {
      if (i === tries - 1) throw err;
      await sleep(3000 * (i + 1));
    }
  }
  throw new Error("unreachable");
}

async function callOpenAI(rows: Row[]) {
  const payload = rows.map((r, i) => ({
    idx: i,
    subreddit: r.subreddit,
    rank: r.rank,
    title: r.title,
    body: (r.body ?? "").slice(0, BODY_LIMIT),
  }));

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: `다음 레딧 글 ${rows.length}건을 분류해라.\n\n${JSON.stringify(payload, null, 1)}` },
      ],
      response_format: { type: "json_schema", json_schema: { name: "classification", strict: true, schema: SCHEMA } },
      temperature: 0.3,
    }),
  });

  if (!res.ok) throw new Error(`openai ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  return {
    results: JSON.parse(data.choices[0].message.content).results as any[],
    usage: data.usage as { prompt_tokens: number; completion_tokens: number },
  };
}

async function saveEntity(mentionId: string, e: any) {
  const ins = await pool.query<{ id: string }>(
    `insert into entities (kind, canonical_name, name_ko)
     values ($1,$2,$3)
     on conflict (kind, canonical_name) do update set
       name_ko = coalesce(entities.name_ko, excluded.name_ko)
     returning id`,
    [e.kind, e.canonical_name.trim(), e.name_ko || null]
  );
  await pool.query(
    `insert into entity_mentions (entity_id, mention_id, source_kind, role, sentiment, quote)
     values ($1,$2,'post',$3,$4,$5)
     on conflict (entity_id, mention_id, source_kind, role) do nothing`,
    [ins.rows[0].id, mentionId, e.role ?? "", e.sentiment ?? null, e.quote || null]
  );
}

export type ClassifyResult = {
  targets: number; done: number; failed: number;
  entities: number; demands: number;
  prompt_tokens: number; completion_tokens: number;
  errors: string[];
};

export async function classifyPosts(limit = 200): Promise<ClassifyResult> {
  // 아직 분류하지 않은 글만. 재실행해도 이미 한 건은 건너뛴다(= API 재과금 없음).
  const rows = (await pool.query<Row>(
    `select m.id, m.title, m.raw->>'body' as body,
            m.raw->>'subreddit' as subreddit, (m.raw->>'rank')::int as rank
       from mentions m
       left join post_analysis a on a.mention_id = m.id
      where m.source = 'reddit' and a.mention_id is null
        and m.raw->>'subreddit' <> 'muacjdiscussion'
        and m.raw->>'rank' is not null
      order by (m.raw->>'rank')::int asc
      limit $1`,
    [limit]
  )).rows;

  const out: ClassifyResult = {
    targets: rows.length, done: 0, failed: 0, entities: 0, demands: 0,
    prompt_tokens: 0, completion_tokens: 0, errors: [],
  };

  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    try {
      if (i > 0) await sleep(1200);
      const { results, usage } = await callWithRetry(batch);
      out.prompt_tokens += usage?.prompt_tokens ?? 0;
      out.completion_tokens += usage?.completion_tokens ?? 0;

      for (const r of results) {
        const row = batch[r.idx];
        if (!row) continue;
        await pool.query(
          `insert into post_analysis
             (mention_id, beauty_area, post_type, topic, topic_en, summary_ko, awareness, worth, layer, model)
           values ($1,$2,$3,$4,$5,$6,$7,$8,1,$9)
           on conflict (mention_id) do update set
             beauty_area=excluded.beauty_area, post_type=excluded.post_type, topic=excluded.topic,
             topic_en=excluded.topic_en, summary_ko=excluded.summary_ko, awareness=excluded.awareness,
             worth=excluded.worth, model=excluded.model, analyzed_at=now()`,
          [row.id, r.beauty_area, r.post_type, r.topic, r.topic_en, r.summary_ko,
           r.awareness, Math.max(0, Math.min(100, r.worth ?? 0)), MODEL]
        );

        for (const e of r.entities ?? []) {
          if (!e?.canonical_name?.trim()) continue;
          await saveEntity(row.id, e);
          out.entities++;
        }

        const d = r.demand;
        if (d && (d.goals?.length || d.budget || d.stay_duration || d.concerns?.length)) {
          await pool.query(
            `insert into demand_signals
               (mention_id, age_band, origin, budget, stay_duration, goals, constraints, concerns)
             values ($1,$2,$3,$4,$5,$6,$7,$8)
             on conflict (mention_id) do update set
               age_band=excluded.age_band, origin=excluded.origin, budget=excluded.budget,
               stay_duration=excluded.stay_duration, goals=excluded.goals,
               constraints=excluded.constraints, concerns=excluded.concerns, extracted_at=now()`,
            [row.id, d.age_band, d.origin, d.budget, d.stay_duration,
             d.goals ?? [], d.constraints ?? [], d.concerns ?? []]
          );
          out.demands++;
        }
        out.done++;
      }
    } catch (err) {
      out.failed += batch.length;
      out.errors.push(`배치 ${i / BATCH + 1}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return out;
}
