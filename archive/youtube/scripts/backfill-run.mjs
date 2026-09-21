// 지금까지 쌓인 데이터를 "초기" 실행 하나로 묶는다. 한 번만 돌리면 된다.
//   node --env-file=.env.local scripts/backfill-run.mjs
//
// 안 돌리면 기존 카드·분석이 run_id 없이 남아, 워크스페이스 화면에서 안 보인다.
import pg from "pg";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL이 없습니다.");
  process.exit(1);
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

const { rows: [ws] } = await client.query(`select id, name from workspaces order by created_at limit 1`);
if (!ws) {
  console.error("워크스페이스가 없습니다. npm run seed 를 먼저 돌리세요.");
  process.exit(1);
}

// 이번 주 월요일. **워크스페이스의 타임존으로** 계산한다.
// now()만 쓰면 서버 UTC 기준이 되어, 한국 월요일 새벽이 UTC로는 일요일이라
// 지난 주차로 들어간다. runs.week를 쓰는 다른 코드(lib/schedule.ts)와도 어긋난다.
const { rows: [{ monday }] } = await client.query(
  `select (date_trunc('week', now() at time zone timezone))::date as monday
     from workspaces where id = $1`,
  [ws.id]
);

for (const [kind, tables] of [
  ["reddit", ["post_analysis", "idea_cards"]],
  ["video", ["video_keywords"]],
]) {
  const { rows: [run] } = await client.query(
    `insert into runs (workspace_id, week, kind, status, stats, finished_at)
     values ($1, $2::date, $3, 'done', '{"note":"기존 데이터 이관"}'::jsonb, now())
     on conflict (workspace_id, week, kind) do update set status = 'done'
     returning id`,
    [ws.id, monday, kind]
  );
  // 몇 건을 묶었는지 stats에 남긴다. 안 남기면 마이페이지 실행 기록이
  // 실제로 100건을 묶고도 "글 0건 · 카드 0장"으로 보인다.
  const counted = {};
  for (const t of tables) {
    const r = await client.query(`update ${t} set run_id = $1 where run_id is null`, [run.id]);
    counted[t] = r.rowCount;
    console.log(`✔ ${t} ${r.rowCount}건 → 실행 #${run.id} (${kind})`);
  }

  const stats = kind === "reddit"
    ? { posts: counted.post_analysis, cards: counted.idea_cards }
    : { keywords: counted.video_keywords };
  await client.query(
    `update runs set stats = stats || $2::jsonb where id = $1`,
    [run.id, JSON.stringify(stats)]
  );
}

console.log(`\n워크스페이스: ${ws.name}`);
await client.end();
