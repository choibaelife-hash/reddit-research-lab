import { pool } from "./db.js";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL이 없습니다. .env.local을 확인하세요.");
  process.exit(1);
}

// §20 미정 항목 3 — 경민이 채팅에서 직접 조사·검증한 목록 (2026-08-21)
const RSS_SOURCES = [
  ["K Beauty Hobbit", "https://kbeautyhobbit.com/blog-feed.xml"],
  ["The Beauty Look Book", "https://thebeautylookbook.com/feed"],
  ["Pro Beauty Association News", "https://probeauty.org/news/feed/"],
  ["Allure", "https://www.allure.com/feed/rss"],
  ["Byrdie", "https://feeds-api.dotdashmeredith.com/v1/rss/google/6772aca0-2ce6-4ccc-8a40-d5556ba3a9c7"],
  ["Oprah Daily Beauty", "https://www.oprahdaily.com/rss/beauty.xml"],
  ["PopSugar Beauty", "https://www.popsugar.com/beauty/feed"],
  ["Refinery29 Beauty", "https://www.refinery29.com/beauty/rss.xml"],
  ["ELLE Beauty", "https://www.elle.com/rss/beauty.xml/"],
  ["Glamour", "https://www.glamour.com/feed/rss"],
  ["Teen Vogue Beauty", "https://www.teenvogue.com/feed/rss"],
  ["Self Beauty", "https://www.self.com/feed/rss"],
  ["WWD Beauty Inc", "https://wwd.com/feed/rss/"],
];

for (const [name, url] of RSS_SOURCES) {
  const result = await pool.query(
    `insert into collection_rules (category, source, value, enabled)
     values ($1, 'rss', $2, true)
     on conflict (category, source, value) do nothing
     returning id`,
    ["products", url]
  );
  console.log(result.rows.length ? `추가됨: ${name}` : `이미 있음: ${name}`);
}

await pool.end();
