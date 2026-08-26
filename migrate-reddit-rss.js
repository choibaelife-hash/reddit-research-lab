import { pool } from "./db.js";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL이 없습니다. .env.local을 확인하세요.");
  process.exit(1);
}

// 서브레딧별 수집 기간(week/month) 같은 소스별 설정을 담는 자리.
// 활성도가 낮은 서브레딧은 week로 받으면 건수가 부족해서 기간을 늘려야 한다.
await pool.query(
  `alter table collection_rules add column if not exists options jsonb not null default '{}'::jsonb`
);
console.log("✔ collection_rules.options 컬럼 준비 완료");

// r/muacjdiscussion은 week로 받으면 12건뿐(2026-08-25 실측) — 월간으로 넓힌다
const m = await pool.query(
  `update collection_rules set options = jsonb_set(options, '{period}', '"month"')
   where source = 'reddit' and value = 'muacjdiscussion'`
);
console.log(`✔ muacjdiscussion 월간 설정 (${m.rowCount}행)`);

// 나머지 3개 서브레딧은 collection_rules에 등록만 되고 한 번도 수집된 적이 없음 → 그대로 두면 이번 수집부터 포함됨

// 정기 게시판 제목 — 기존 4개로는 muacjdiscussion 요일 스레드가 하나도 안 걸러졌다(8개 중 7개 통과)
const EXCLUDES = [
  "Faves and Fails",
  "Simple Questions",
  "Temper Tantrum",
  "Miscellaneous Monday",
  "Free Talk",
  "Request a Review",
  "Not Gonna Buy",
];
for (const value of EXCLUDES) {
  const r = await pool.query(
    `insert into title_excludes (value) values ($1) on conflict (value) do nothing returning id`,
    [value]
  );
  console.log(r.rows.length ? `  + 제외어 추가: ${value}` : `  · 이미 있음: ${value}`);
}

await pool.end();
