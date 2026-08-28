// 스키마 적용.  node --env-file=.env.local scripts/apply-schema.mjs
// 여러 번 실행해도 안전하다.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL이 없습니다. .env.local을 확인하세요.");
  process.exit(1);
}

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const files = process.argv.slice(2).length ? process.argv.slice(2) : ["schema.sql", "schema-video.sql"];

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

for (const f of files) {
  await client.query(readFileSync(join(root, f), "utf8"));
  console.log(`✔ ${f}`);
}

const { rows } = await client.query(
  `select table_name from information_schema.tables
    where table_schema = 'public' order by 1`
);
console.log(`\nDB 테이블 ${rows.length}개`);
await client.end();
