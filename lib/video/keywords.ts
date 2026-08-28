import { pool } from "@/lib/db";

// 이번 주 레딧 데이터에서 유튜브 검색어 5개를 뽑는다.
//
// 빈도만 쓰면 흔한 단어("sunscreen")가 이기고, worth만 쓰면 표본이 12장뿐이라 흔들린다.
// 그래서 빈도 × 평균 worth 로 섞는다. 어느 쪽도 단독으로는 신뢰하지 않는다.
//
// PRD 5.3 참고: 레딧 top 순위는 소재 가치와 무관했다(r=+0.15).
// 여기 점수도 검증 전까지는 가설이다. reason 컬럼에 근거를 남겨 나중에 따져볼 수 있게 한다.

export type PickedKeyword = {
  keyword: string; rank: number; score: number;
  reason: { freq: number; avg_worth: number; source: "entity" | "topic"; search_query?: string };
};

// 검색어로 못 쓰는 것들. 너무 흔하거나 유튜브에서 의미가 없다.
const STOP = new Set([
  "skincare", "skin", "beauty", "product", "products", "routine",
  "korean", "korea", "kbeauty", "k-beauty", "face", "help", "advice",
]);

const mondayOf = (d = new Date()) => {
  const x = new Date(d);
  x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7));
  return x.toISOString().slice(0, 10);
};

// 기본 서비스는 주 3키워드로 고정한다(2026-08-27 결정).
export async function pickKeywords(week = mondayOf(), limit = 3): Promise<PickedKeyword[]> {
  // 엔티티(제품·성분·브랜드·시술)에서 뽑는다. 사람이 유튜브에 실제로 칠 만한 말이다.
  const ents = (await pool.query<{ name: string; freq: number; avg_worth: number }>(
    `select e.canonical_name as name,
            count(*)::int as freq,
            coalesce(avg(a.worth), 0)::numeric(6,2) as avg_worth
       from entities e
       join entity_mentions em on em.entity_id = e.id
       join post_analysis a on a.mention_id = em.mention_id
       join mentions m on m.id = em.mention_id
      where m.occurred_at >= $1::date - interval '7 days'
        and e.kind in ('product', 'ingredient', 'brand', 'procedure')
      group by 1
     having count(*) >= 2
      order by freq desc limit 40`,
    [week]
  )).rows;

  // 카드가 된 글의 topic도 후보에 넣는다. 엔티티가 못 잡는 상황 표현이 여기 있다.
  const topics = (await pool.query<{ name: string; freq: number; avg_worth: number }>(
    `select a.topic as name, count(*)::int as freq,
            coalesce(avg(a.worth), 0)::numeric(6,2) as avg_worth
       from post_analysis a
       join mentions m on m.id = a.mention_id
      where m.occurred_at >= $1::date - interval '7 days'
        and a.topic is not null and a.topic <> ''
      group by 1 order by avg_worth desc limit 20`,
    [week]
  )).rows;

  const pool_: PickedKeyword[] = [
    ...ents.map((r) => ({ ...r, source: "entity" as const })),
    ...topics.map((r) => ({ ...r, source: "topic" as const })),
  ]
    .filter((r) => r.name && !STOP.has(r.name.toLowerCase().trim()))
    .map((r) => ({
      keyword: r.name.trim(),
      rank: 0,
      // 빈도는 로그로 눌러 흔한 단어의 독주를 막고, worth로 가중한다.
      score: Number((Math.log2(r.freq + 1) * (Number(r.avg_worth) / 100 + 0.3)).toFixed(4)),
      reason: { freq: r.freq, avg_worth: Number(r.avg_worth), source: r.source },
    }));

  // 같은 말이 엔티티와 topic 양쪽에서 나오면 높은 쪽만 남긴다.
  const best = new Map<string, PickedKeyword>();
  for (const k of pool_) {
    const key = k.keyword.toLowerCase();
    if (!best.has(key) || best.get(key)!.score < k.score) best.set(key, k);
  }

  return [...best.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((k, i) => ({ ...k, rank: i + 1 }));
}

export async function saveKeywords(week: string, picks: PickedKeyword[]) {
  const ids: number[] = [];
  for (const p of picks) {
    const r = await pool.query<{ id: number }>(
      `insert into video_keywords (week, keyword, rank, score, reason)
       values ($1, $2, $3, $4, $5)
       on conflict (week, keyword)
         do update set rank = excluded.rank, score = excluded.score, reason = excluded.reason
       returning id`,
      [week, p.keyword, p.rank, p.score, JSON.stringify(p.reason)]
    );
    ids.push(r.rows[0].id);
  }
  return ids;
}

export { mondayOf };
