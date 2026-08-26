import { readFileSync } from "node:fs";
import { pool } from "./db.js";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL이 없습니다. .env.local을 확인하세요.");
  process.exit(1);
}

const schema = readFileSync(new URL("./schema.sql", import.meta.url), "utf8");

const [{ count }] = (
  await pool.query(
    `select count(*)::int from information_schema.tables where table_schema = 'public' and table_name = 'keywords'`
  )
).rows;

if (count > 0) {
  console.log("이미 스키마가 있습니다 (keywords 테이블 존재) — 건너뜀.");
} else {
  await pool.query(schema);
  console.log("스키마 생성 완료 (12개 테이블).");
}

await pool.end();
