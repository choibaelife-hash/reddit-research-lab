import { pool } from "./db.js";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL이 없습니다. .env.local을 확인하세요.");
  process.exit(1);
}

// Apify로 실제 결과 확인된 서브레딧만 (2026-08-21) — 나머지는 /admin/rules에서 직접 추가
const REDDIT_SOURCES = [
  ["AsianBeauty"],
  ["SkincareAddiction"],
];

for (const [subreddit] of REDDIT_SOURCES) {
  const result = await pool.query(
    `insert into collection_rules (category, source, value, enabled)
     values ($1, 'reddit', $2, true)
     on conflict (category, source, value) do nothing
     returning id`,
    ["products", subreddit]
  );
  console.log(result.rows.length ? `추가됨: r/${subreddit}` : `이미 있음: r/${subreddit}`);
}

await pool.end();
