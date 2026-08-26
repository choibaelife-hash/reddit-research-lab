import { pool } from "@/lib/db";

// 소재 가치(worth) 계산.
//
// 예전에는 LLM이 0~100 숫자를 통째로 뱉었다. 문제가 셋이었다:
//   1) 왜 그 점수인지 설명이 안 된다  2) 재현이 안 된다  3) 기준이 "우리가 쓸 수 있나"(공급)였다
// 이 서비스가 물어야 하는 건 "사람들이 뭘 찾고 있나"(수요)다. 그래서 전부 수요 기준으로 다시 짰다.
//
// 이제 LLM은 "한국 관련도" 20점만 판단하고, 나머지 80점은 데이터에서 계산한다.
// 분해는 worth_parts에 저장해서 화면에 "왜 87점인지" 그대로 보여준다.
// 가중치를 바꿔도 LLM 재호출 없이 재계산만 하면 된다.

// 배점 — 기본 100 + 가산 최대 30, 상한 100
//
// 처음엔 7개 항목을 합쳐 100점으로 짰는데 평균이 43점밖에 안 나왔다.
// 원인: 댓글은 34/100건에만 있고, 키워드 확산은 1주치라 대부분 0이며, 매거진 매칭도 30/100이었다.
// 즉 "우리가 아직 안 모은 데이터"가 "가치가 낮은 글"로 계산되고 있었다. 설계 오류다.
//
// 그래서 두 종류로 나눈다:
//   기본 — 모든 글이 동등하게 갖는 것. 이것만으로 100점 만점이 된다.
//   가산 — 있으면 위로 밀어주고, 없어도 손해가 아니다. 데이터가 쌓일수록 변별이 살아난다.
const BASE = { rank: 40, question: 30, korea: 30 };            // 합 100
const BONUS = { comments: 12, spread_posts: 12, magazine: 6 };  // 최대 +30

// 질문 밀도 — 사람들이 답을 찾고 있는 글일수록 높다
const TYPE_SCORE: Record<string, number> = {
  추천요청: 30, 비교질문: 30,
  진단도움: 22, 정보설명: 22,
  후기리뷰: 16, 경험공유: 16,
  경고이슈: 12,
  잡담: 0,
};

// 업보트는 순위가 내려갈수록 지수적으로 줄어든다. 선형으로 나누면 상위권 변별이 뭉개진다.
//   1위 25점 · 5위 약 20 · 10위 약 15 · 25위 약 6
const rankScore = (rank: number) => BASE.rank * Math.exp(-0.045 * (rank - 1));

export type ScoreParts = {
  // 기본 — 합 100
  rank: number;        // 0~40  레딧 top 순위(=그 주 업보트 순위)
  question: number;    // 0~30  질문 밀도
  korea: number;       // 0~30  한국 관련도 (LLM이 판단하는 유일한 항목)
  // 가산 — 최대 +30
  comments: number;    // 0~12  댓글 수 + 정보 밀도
  spread: number;      // 0~12  키워드가 몇 개 글·몇 개 서브레딧에 걸쳤나
  magazine: number;    // 0~6   매거진도 다뤘나
  // 참고
  base: number;
  bonus: number;
};

const sum = (p: ScoreParts) => Math.min(100, p.base + p.bonus);

export type ScoreResult = {
  scored: number;
  missingKorea: number;
  avg: number;
  distribution: { band: string; n: number }[];
};

export async function rescoreAll(): Promise<ScoreResult> {
  // ── 1. 매거진 커버리지: entities 이름이 RSS 기사에 나오는지 문자열로 찾는다 (LLM 0원) ──
  // 최근 30일 기사만 본다. 6개월 전 기사에 나온 키워드는 "이번 주 화제"의 증거가 아니다.
  const rssDocs = (await pool.query<{ text: string }>(
    `select lower(coalesce(title,'') || ' ' || coalesce(raw->>'contentSnippet','')) as text
       from mentions
      where source = 'rss' and occurred_at > now() - interval '30 days'`
  )).rows.map((r) => r.text);

  const entNames = (await pool.query<{ id: string; name: string }>(
    `select id, canonical_name as name from entities where length(canonical_name) >= 3`
  )).rows;

  const inMagazine = new Set<string>();
  for (const e of entNames) {
    const needle = e.name.toLowerCase();
    if (rssDocs.some((d) => d.includes(needle))) inMagazine.add(e.id);
  }

  // ── 2. 글마다 계산에 필요한 재료를 한 번에 모은다 ──
  const rows = (await pool.query<{
    mention_id: string;
    rank: number | null;
    post_type: string;
    topic: string;
    kr_relevance: number | null;
    cmt_count: number;
    cmt_entities: number;
    ent_ids: string[];
  }>(
    `select a.mention_id,
            (m.raw->>'rank')::int as rank,
            a.post_type, a.topic, a.kr_relevance,
            (select count(*)::int from post_comments c where c.mention_id = m.id) as cmt_count,
            (select count(*)::int from entity_mentions em
              where em.mention_id = m.id and em.source_kind = 'comment') as cmt_entities,
            coalesce((select array_agg(distinct em.entity_id::text)
                        from entity_mentions em where em.mention_id = m.id), '{}') as ent_ids
       from post_analysis a
       join mentions m on m.id = a.mention_id`
  )).rows;

  // ── 3. 키워드 확산: 각 엔티티가 몇 개 글 / 몇 개 서브레딧에 나왔나 ──
  const spreadMap = new Map<string, { posts: number; subs: number }>();
  for (const r of (await pool.query<{ entity_id: string; posts: number; subs: number }>(
    `select em.entity_id::text as entity_id,
            count(distinct em.mention_id)::int as posts,
            count(distinct m.raw->>'subreddit')::int as subs
       from entity_mentions em join mentions m on m.id = em.mention_id
      group by 1`
  )).rows) spreadMap.set(r.entity_id, { posts: r.posts, subs: r.subs });

  // 같은 topic이 몇 개 글에 나왔나 (엔티티가 없는 글의 대체 신호)
  const topicCount = new Map<string, number>();
  for (const r of (await pool.query<{ topic: string; n: number }>(
    `select topic, count(*)::int as n from post_analysis where topic is not null group by 1`
  )).rows) topicCount.set(r.topic, r.n);

  const clamp = (v: number, max: number) => Math.max(0, Math.min(max, Math.round(v)));
  let scored = 0, missingKorea = 0, total = 0;
  const bands: Record<string, number> = { "80+": 0, "60-79": 0, "40-59": 0, "20-39": 0, "0-19": 0 };

  for (const r of rows) {
    // 레딧 순위 — top 25만 받으므로 이 값 자체가 그 주 업보트 순위다.
    const rank = r.rank == null ? 16 : clamp(rankScore(r.rank), BASE.rank);

    // 댓글 — 개수와 "정보 밀도"(댓글에서 뽑힌 실체 수)를 반반.
    // 개수만 세면 논쟁·공감글이 높게 나온다. 실체가 나와야 정보성 댓글이다.
    const comments = r.cmt_count === 0 ? 0
      : clamp(Math.min(r.cmt_count, 5) / 5 * 5 + Math.min(r.cmt_entities, 6) / 6 * 7, BONUS.comments);

    // 키워드 확산 — 이 글의 엔티티 중 가장 널리 퍼진 것 기준
    let maxPosts = topicCount.get(r.topic) ?? 1;
    let maxSubs = 1;
    for (const id of r.ent_ids) {
      const s = spreadMap.get(id);
      if (!s) continue;
      if (s.posts > maxPosts) maxPosts = s.posts;
      if (s.subs > maxSubs) maxSubs = s.subs;
    }
    // 확산 — 글 수와 서브레딧 수를 하나로 합친다
    const spread = clamp(
      (Math.min(maxPosts, 6) - 1) / 5 * 7 + (Math.min(maxSubs, 4) - 1) / 3 * 5, BONUS.spread_posts);

    // 매거진 — 이 글의 엔티티가 뷰티 매거진 기사에도 나오면 넓은 화제라는 증거
    const magazine = r.ent_ids.some((id) => inMagazine.has(id)) ? BONUS.magazine : 0;

    const question = TYPE_SCORE[r.post_type] ?? 12;

    // 한국 관련도만 LLM이 판단한다. 아직 없으면 중간값으로 두고 표시해 둔다.
    if (r.kr_relevance == null) missingKorea++;
    const korea = clamp((r.kr_relevance ?? 5) * 3, BASE.korea);

    const base = rank + question + korea;
    const bonus = comments + spread + magazine;
    const parts: ScoreParts = { rank, question, korea, comments, spread, magazine, base, bonus };
    const worth = sum(parts);

    await pool.query(
      `update post_analysis set worth = $2, worth_parts = $3, scored_at = now() where mention_id = $1`,
      [r.mention_id, worth, JSON.stringify(parts)]
    );

    scored++; total += worth;
    const b = worth >= 80 ? "80+" : worth >= 60 ? "60-79" : worth >= 40 ? "40-59" : worth >= 20 ? "20-39" : "0-19";
    bands[b]++;
  }

  return {
    scored, missingKorea,
    avg: scored ? Math.round(total / scored) : 0,
    distribution: Object.entries(bands).map(([band, n]) => ({ band, n })),
  };
}
