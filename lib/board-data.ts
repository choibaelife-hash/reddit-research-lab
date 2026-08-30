import { pool } from "@/lib/db";

// 보드 화면이 쓰는 쿼리 모음.
// 정적 HTML 시절엔 파이썬이 이 쿼리들을 돌려 JSON으로 뽑았다. 이제 서버 컴포넌트가 직접 읽는다.

export const SUB_ORDER = ["KoreanBeauty", "AsianBeauty", "SkincareAddiction", "30PlusSkinCare"];

export type Angle = { ko: string; en: string; guide: string };
export type WorthParts = {
  rank: number; question: number; korea: number;
  comments: number; spread: number; magazine: number;
  base: number; bonus: number;
};

export type Card = {
  id: string; title: string; url: string; body: string | null;
  sub: string; rank: number; area: string; type: string; topic: string;
  summary_ko: string; worth: number; worth_parts: WorthParts;
  gap: string | null; angles: Angle[]; detail: Record<string, any>;
  status: string; note: string | null; chosen_angle: number | null;
  comments: { rank: number; author: string | null; body: string; body_ko: string | null }[];
  keywords: string[];
  misconception: { has: boolean; what: string; correction: string } | null;
};

const label = (ko: string | null, en: string | null) =>
  ko && en && ko !== en ? `${ko} / ${en}` : (ko || en || "");

export async function getCards(runId?: string | null): Promise<Card[]> {
  const rows = (await pool.query(
    `select m.id, m.title, m.url, m.raw->>'body' as body,
            m.raw->>'subreddit' as sub, (m.raw->>'rank')::int as rank,
            a.beauty_area as area, a.post_type as type, a.topic, a.summary_ko,
            a.worth, a.worth_parts, a.misconception,
            c.gap, c.angles, c.detail, c.status, c.note, c.chosen_angle
       from idea_cards c
       join mentions m on m.id = c.mention_id
       join post_analysis a on a.mention_id = c.mention_id
      where ($1::bigint is null or c.run_id = $1::bigint)
      order by a.worth desc, m.raw->>'subreddit'`,
    [runId ?? null]
  )).rows;

  for (const r of rows) {
    r.comments = (await pool.query(
      `select rank, author, body, body_ko from post_comments where mention_id = $1 order by rank`, [r.id]
    )).rows;
    r.keywords = (await pool.query<{ ko: string | null; en: string }>(
      `select distinct e.name_ko as ko, e.canonical_name as en
         from entity_mentions em join entities e on e.id = em.entity_id
        where em.mention_id = $1`, [r.id]
    )).rows.map((x) => label(x.ko, x.en)).filter(Boolean);
  }
  return rows as Card[];
}

export type StockRow = {
  id: string; title: string; url: string; sub: string;
  area: string; type: string; topic: string; summary_ko: string;
  worth: number; keywords: string[];
};

export async function getStock(minWorth = 20, runId?: string | null): Promise<StockRow[]> {
  return (await pool.query(
    `select m.id, m.title, m.url, m.raw->>'subreddit' as sub,
            a.beauty_area as area, a.post_type as type, a.topic, a.summary_ko, a.worth,
            coalesce((select array_agg(distinct coalesce(e.name_ko, e.canonical_name))
                        from entity_mentions em join entities e on e.id = em.entity_id
                       where em.mention_id = m.id), '{}') as keywords
       from post_analysis a
       join mentions m on m.id = a.mention_id
       left join idea_cards c on c.mention_id = m.id
      where c.mention_id is null and a.worth > $1
        and ($2::bigint is null or a.run_id = $2::bigint)
      order by a.worth desc`,
    [minWorth, runId ?? null]
  )).rows as StockRow[];
}

export const getStockDropped = async (minWorth = 20, runId?: string | null) =>
  (await pool.query<{ n: number }>(
    `select count(*)::int as n from post_analysis a
       left join idea_cards c on c.mention_id = a.mention_id
      where c.mention_id is null and a.worth <= $1
        and ($2::bigint is null or a.run_id = $2::bigint)`,
    [minWorth, runId ?? null]
  )).rows[0].n;

export const getAreas = async (runId?: string | null) =>
  (await pool.query<{ area: string; n: number; avg_worth: number; with_cmt: number }>(
    `select a.beauty_area as area, count(*)::int as n, round(avg(a.worth))::int as avg_worth,
            count(*) filter (where exists(select 1 from post_comments c where c.mention_id = a.mention_id))::int as with_cmt
       from post_analysis a
      where ($1::bigint is null or a.run_id = $1::bigint)
      group by 1 order by n desc`,
    [runId ?? null]
  )).rows;

export const getAreaPosts = async (area: string, runId?: string | null) =>
  (await pool.query<{ worth: number; title: string; url: string; topic: string; type: string }>(
    `select a.worth, m.title, m.url, a.topic, a.post_type as type
       from post_analysis a join mentions m on m.id = a.mention_id
      where a.beauty_area = $1
        and ($2::bigint is null or a.run_id = $2::bigint)
      order by a.worth desc limit 14`,
    [area, runId ?? null]
  )).rows;

export const getAreaTypes = async (area: string, runId?: string | null) =>
  (await pool.query<{ type: string; n: number }>(
    `select post_type as type, count(*)::int as n from post_analysis
      where beauty_area = $1
        and ($2::bigint is null or run_id = $2::bigint)
      group by 1 order by n desc`,
    [area, runId ?? null]
  )).rows;

// 아래 조회들은 실행번호로 거르지 않는다.
// entities(이름 사전)와 mentions(레딧 원본)는 워크스페이스끼리 공유하는 자산이기 때문이다.
// 같은 서브레딧을 고객 수만큼 중복 수집하면 레딧이 429로 막는다(07-SAAS.md 1장).
export const getKeywords = async () =>
  (await pool.query<{
    name: string; name_ko: string | null; kind: string;
    total: number; asked: number; reco: number; rev: number;
  }>(
    `select e.canonical_name as name, e.name_ko, e.kind, count(*)::int as total,
            count(*) filter (where em.role = 'asked_about')::int as asked,
            count(*) filter (where em.role = 'recommended')::int as reco,
            count(*) filter (where em.role = 'reviewed')::int as rev
       from entities e join entity_mentions em on em.entity_id = e.id
      group by 1,2,3 order by total desc, name limit 30`
  )).rows;

export const getEntityKinds = async () =>
  (await pool.query<{ kind: string; n: number }>(
    `select kind, count(*)::int as n from entities group by 1 order by n desc`
  )).rows;

export const getTopEntities = async () =>
  (await pool.query<{ kind: string; name: string; name_ko: string | null; n: number; roles: string }>(
    `select e.kind, e.canonical_name as name, e.name_ko, count(*)::int as n,
            string_agg(distinct em.role, ',') as roles
       from entities e join entity_mentions em on em.entity_id = e.id
      group by 1,2,3 having count(*) >= 2 order by n desc, name limit 20`
  )).rows;

export const getDemands = async () =>
  (await pool.query(
    `select d.*, m.url from demand_signals d join mentions m on m.id = d.mention_id`
  )).rows;

export const getClinicGap = async () =>
  (await pool.query<{ worth: number; title: string; url: string; type: string }>(
    `select a.worth, m.title, m.url, a.post_type as type
       from post_analysis a join mentions m on m.id = a.mention_id
      where a.beauty_area = '시술클리닉' and a.comments_checked_at is null
      order by a.worth desc limit 10`
  )).rows;

export const getRssFeeds = async () =>
  (await pool.query<{ feed: string; n: number; newest: string }>(
    `select raw->>'feed' as feed, count(*)::int as n, max(occurred_at)::date::text as newest
       from mentions where source = 'rss' group by 1 order by n desc`
  )).rows;

export const getRssItems = async (limit = 200) =>
  (await pool.query<{ feed: string; title: string; url: string; day: string; snippet: string }>(
    `select raw->>'feed' as feed, title, url, occurred_at::date::text as day,
            left(raw->>'contentSnippet', 200) as snippet
       from mentions where source = 'rss' order by occurred_at desc limit $1`, [limit]
  )).rows;

export const getStats = async (runId?: string | null) =>
  (await pool.query<{ posts: number; cards: number; entities: number; comments: number; avg_worth: number }>(
    `select (select count(*)::int from post_analysis
              where ($1::bigint is null or run_id = $1::bigint)) as posts,
            (select count(*)::int from idea_cards
              where ($1::bigint is null or run_id = $1::bigint)) as cards,
            (select count(*)::int from entities) as entities,
            (select count(distinct mention_id)::int from post_comments) as comments,
            (select round(avg(worth))::int from post_analysis
              where ($1::bigint is null or run_id = $1::bigint)) as avg_worth`,
    [runId ?? null]
  )).rows[0];
