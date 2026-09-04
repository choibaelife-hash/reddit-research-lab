// Railway 크론 진입점.
//
// Vercel은 vercel.json의 crons를 읽어 엔드포인트를 대신 호출해줬지만, Railway는 그러지 않는다.
// 대신 Railway 크론이 이 스크립트를 컨테이너로 실행하고, 스크립트가 웹 서비스를 호출한다.
//
//   node scripts/cron.mjs due       ★ 실제 운영용. 지금 돌 차례인 워크스페이스만 골라 전 단계를 돈다
//   node scripts/cron.mjs reddit    레딧 파이프라인(idle까지 반복) — 수동 실행용
//   node scripts/cron.mjs video     영상 1단계(키워드→검색→아웃라이어) — 수동
//   node scripts/cron.mjs analyze   영상 2단계(자막·썸네일·첫15초·종합) — 수동
//
// Railway에는 `due` 하나만 매시간(0 * * * *) 등록한다.
// 요일·시각은 코드가 아니라 DB(workspaces.schedule_dow/hour/timezone)에 있다.
// 고객이 100명이 돼도 Railway 크론은 1개다 — 늘어나는 건 DB의 줄 하나뿐이다.
//
// 왜 HTTP로 부르는가: 로직이 Next.js 라우트 안에 있어 그대로 재사용하는 게 가장 짧다.
// Railway는 서버리스가 아니라 요청이 10분 걸려도 끊기지 않는다(02-INFRA 4장).

const BASE = process.env.APP_URL;
const SECRET = process.env.CRON_SECRET;
if (!BASE) throw new Error("APP_URL 없음 — 웹 서비스 주소를 넣을 것 (예: https://xxx.up.railway.app)");
if (!SECRET) throw new Error("CRON_SECRET 없음");

const job = process.argv[2];
const log = (...a) => console.log(new Date().toISOString(), ...a);

async function call(path, { timeoutMs = 3_600_000 } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${SECRET}` },
    signal: AbortSignal.timeout(timeoutMs),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`${path} ${res.status}: ${body.slice(0, 300)}`);
  try { return JSON.parse(body); } catch { return body; }
}

// 레딧 파이프라인은 한 번 호출에 한 단계만 처리한다.
// Vercel에서는 300초 한도 때문에 크론을 4번 걸어뒀지만, 여기서는 idle까지 그냥 돌린다.
// 무한 루프 방어: pipeline.ts가 0건 처리 시 stalled로 멈추지만, 여기서도 상한을 둔다.
async function reddit(ws = "") {
  const q = ws ? `?ws=${ws}` : "";
  for (let i = 1; i <= 40; i++) {
    const r = await call(`/api/cron/tick${q}`);
    log(`tick ${i}`, JSON.stringify(r).slice(0, 200));
    if (r?.stoppedBecause === "stalled") throw new Error(`stalled: ${r.error ?? ""}`);
    const { next } = await call(`/api/cron/tick${ws ? q + "&" : "?"}peek=1`);
    if (next === "idle") return log("idle 도달");
  }
  throw new Error("40회를 돌고도 idle에 도달하지 못했다 — 조건을 확인할 것");
}

/**
 * 운영용. 매시간 깨어나 "지금 돌 차례인 워크스페이스"를 물어보고 그것만 돈다.
 *
 * 한 워크스페이스 안에서는 순서를 지킨다 — 레딧이 진짜 끝난 뒤에 영상으로 간다.
 * 시각을 따로 잡아 놓으면 레딧이 늦어질 때 영상이 빈 데이터로 먼저 돈다.
 *
 * 하나가 실패해도 나머지 워크스페이스는 계속한다. 한 고객의 실패가 다른 고객을 막으면 안 된다.
 */
async function due() {
  const { due: list } = await call("/api/cron/due");
  if (!list?.length) return log("지금 돌 차례인 워크스페이스 없음");
  log(`대상 ${list.length}개:`, list.map((w) => w.name).join(", "));

  let failed = 0;
  for (const w of list) {
    try {
      log(`── ${w.name} (${w.week}) 시작`);
      await reddit(w.id);
      const v = await call(`/api/cron/video?ws=${w.id}`);
      log(`  영상 1단계`, JSON.stringify(v).slice(0, 200));
      const a = await call(`/api/cron/video-analyze?ws=${w.id}&limit=15`);
      log(`  영상 2단계 분석 ${a.analyzed}편 · 종합 ${a.synthesized?.length ?? 0}건`);
      log(`── ${w.name} 완료`);
    } catch (e) {
      failed++;
      log(`── ${w.name} 실패:`, e.message);
    }
  }
  if (failed) throw new Error(`${list.length}개 중 ${failed}개 실패`);
}

const jobs = {
  due,
  reddit: () => reddit(),
  video: () => call("/api/cron/video").then((r) => log("video", JSON.stringify(r).slice(0, 400))),
  // 2단계는 오래 걸린다. 실패한 영상이 있어도 나머지는 진행되고, 재실행하면 안 끝난 것만 다시 잡는다.
  analyze: () => call("/api/cron/video-analyze?limit=15").then((r) =>
    log("analyze", `분석 ${r.analyzed}편 · 종합 ${r.synthesized?.length ?? 0}건`)),
};

if (!jobs[job]) {
  console.error(`쓸 수 있는 작업: ${Object.keys(jobs).join(" | ")}`);
  process.exit(1);
}

jobs[job]()
  .then(() => { log(`${job} 완료`); process.exit(0); })
  .catch((e) => { log(`${job} 실패:`, e.message); process.exit(1); });
