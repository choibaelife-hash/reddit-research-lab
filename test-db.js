import { pool } from "./db.js";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL이 없습니다. .env.local을 확인하세요.");
  process.exit(1);
}

const insert = await pool.query(
  `insert into keywords (label, summary, category) values ($1, $2, $3)
   returning id, label, category, status, first_seen_at`,
  ["S1 테스트 키워드", "insert/select 동작 확인용", "products"]
);
console.log("insert 결과:", insert.rows[0]);

const select = await pool.query(`select * from keywords where id = $1`, [insert.rows[0].id]);
console.log("select 결과:", select.rows[0]);

await pool.query(`delete from keywords where id = $1`, [insert.rows[0].id]);
console.log("테스트 행 정리 완료 — 반복 실행 가능.");

await pool.end();
