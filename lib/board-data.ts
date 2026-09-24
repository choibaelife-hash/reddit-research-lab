import { pool } from "@/lib/db";

// 보드 화면이 쓰는 쿼리 모음.
// 정적 HTML 시절엔 파이썬이 이 쿼리들을 돌려 JSON으로 뽑았다. 이제 서버 컴포넌트가 직접 읽는다.

export const SUB_ORDER = ["KoreanBeauty", "AsianBeauty", "SkincareAddiction", "30PlusSkinCare"];
export const BOARD_PAGE_SIZE = 30;

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

export type CardSummary = Pick<Card,
  "id" | "title" | "sub" | "area" | "type" | "topic" | "worth" | "angles" | "status" | "chosen_angle"
>;

/** 한눈에 탭은 댓글·본문·상세 근거를 사용하지 않는다. */
export async function getCardSummaries(runId: string): Promise<CardSummary[]> {
  return (await pool.query<CardSummary>(
    `select m.id, m.title, m.raw->>'subreddit' as sub,
            a.beauty_area as area, a.post_type as type, a.topic, a.worth,
            c.angles, c.status, c.chosen_angle
       from idea_cards c
       join mentions m on m.id = c.mention_id
       join post_analysis a on a.mention_id = c.mention_id
      where c.run_id = $1::bigint
      order by a.worth desc, m.raw->>'subreddit'`,
    [runId]
  )).rows;
}

export async function getCards(
  runId?: string | null,
  { savedOnly = false, includeComments = true }: { savedOnly?: boolean; includeComments?: boolean } = {}
): Promise<Card[]> {
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
        and (not $2::boolean or c.status = 'saved')
      order by a.worth desc, m.raw->>'subreddit'`,
    [runId ?? null, savedOnly]
  )).rows;

  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  // 카드 수와 무관하게 상세 조회는 최대 두 번. 서로 독립적이므로 함께 실행한다.
  const [comments, keywords] = await Promise.all([
    includeComments ? pool.query<Card["comments"][number] & { mention_id: string }>(
      `select mention_id, rank, author, body, body_ko from post_comments
        where mention_id = any($1::uuid[]) order by mention_id, rank`, [ids]
    ).then((r) => r.rows) : Promise.resolve([]),
    pool.query<{ mention_id: string; ko: string | null; en: string }>(
      `select distinct em.mention_id, e.name_ko as ko, e.canonical_name as en
         from entity_mentions em join entities e on e.id = em.entity_id
        where em.mention_id = any($1::uuid[])`, [ids]
    ).then((r) => r.rows),
  ]);
  const commentsById = new Map<string, Card["comments"]>();
  const keywordsById = new Map<string, string[]>();
  for (const { mention_id, ...comment } of comments) {
    const key = String(mention_id);
    const list = commentsById.get(key) ?? [];
    list.push(comment);
    commentsById.set(key, list);
  }
  for (const { mention_id, ko, en } of keywords) {
    const key = String(mention_id);
    const list = keywordsById.get(key) ?? [];
    const text = label(ko, en);
    if (text) list.push(text);
    keywordsById.set(key, list);
  }
  return rows.map((r) => ({ ...r,
    comments: commentsById.get(String(r.id)) ?? [],
    keywords: keywordsById.get(String(r.id)) ?? [],
  })) as Card[];
}

export type StockRow = {
  id: string; title: string; url: string; sub: string;
  area: string; type: string; topic: string; summary_ko: string;
  worth: number; keywords: string[];
};

export async function getStockPage(runId: string, sub: string | null, page: number): Promise<StockRow[]> {
  const rows = (await pool.query<Omit<StockRow, "keywords">>(
    `select m.id, m.title, m.url, m.raw->>'subreddit' as sub,
            a.beauty_area as area, a.post_type as type, a.topic, a.summary_ko, a.worth
       from post_analysis a
       join mentions m on m.id = a.mention_id
       left join idea_cards c on c.mention_id = m.id
      where c.mention_id is null and a.worth > 20 and a.run_id = $1::bigint
        and ($2::text is null or m.raw->>'subreddit' = $2)
      order by a.worth desc, m.id
      limit $3 offset $4`,
    [runId, sub, BOARD_PAGE_SIZE, (page - 1) * BOARD_PAGE_SIZE]
  )).rows;
  if (!rows.length) return [];
  const keywords = (await pool.query<{ mention_id: string; keywords: string[] }>(
    `select em.mention_id, array_agg(distinct coalesce(e.name_ko, e.canonical_name)) as keywords
       from entity_mentions em join entities e on e.id = em.entity_id
      where em.mention_id = any($1::uuid[])
      group by em.mention_id`,
    [rows.map((r) => r.id)]
  )).rows;
  const byId = new Map(keywords.map((r) => [String(r.mention_id), r.keywords]));
  return rows.map((r) => ({ ...r, keywords: byId.get(String(r.id)) ?? [] }));
}

// 필터·페이지를 바꿔도 전체 건수는 같은 집계를 사용한다.
export const getStockCounts = async (runId: string) =>
  (await pool.query<{ sub: string; kept: number; dropped: number }>(
    `select m.raw->>'subreddit' as sub,
            count(*) filter (where a.worth > 20)::int as kept,
            count(*) filter (where a.worth <= 20)::int as dropped
       from post_analysis a
       join mentions m on m.id = a.mention_id
       left join idea_cards c on c.mention_id = a.mention_id
      where c.mention_id is null and a.run_id = $1::bigint
      group by 1`,
    [runId]
  )).rows;

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

export const getRssItems = async (limit = BOARD_PAGE_SIZE, offset = 0) =>
  (await pool.query<{ id: string; feed: string; title: string; url: string; day: string; snippet: string }>(
    `select id, raw->>'feed' as feed, title, url, occurred_at::date::text as day,
            left(raw->>'contentSnippet', 200) as snippet
       from mentions where source = 'rss' order by occurred_at desc, id desc limit $1 offset $2`, [limit, offset]
  )).rows;

export const getStats = async (runId?: string | null) =>
  (await pool.query<{ posts: number; cards: number; saved: number; entities: number; comments: number; avg_worth: number }>(
    `select (select count(*)::int from post_analysis
              where ($1::bigint is null or run_id = $1::bigint)) as posts,
            (select count(*)::int from idea_cards
              where ($1::bigint is null or run_id = $1::bigint)) as cards,
            (select count(*)::int from idea_cards
              where status = 'saved' and ($1::bigint is null or run_id = $1::bigint)) as saved,
            (select count(*)::int from entities) as entities,
            (select count(distinct mention_id)::int from post_comments) as comments,
            (select round(avg(worth))::int from post_analysis
              where ($1::bigint is null or run_id = $1::bigint)) as avg_worth`,
    [runId ?? null]
  )).rows[0];
