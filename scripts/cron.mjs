// Railway 크론 진입점.
//
// Vercel은 vercel.json의 crons를 읽어 엔드포인트를 대신 호출해줬지만, Railway는 그러지 않는다.
// 대신 Railway 크론이 이 스크립트를 컨테이너로 실행하고, 스크립트가 웹 서비스를 호출한다.
//
//   node scripts/cron.mjs reddit    레딧 파이프라인(idle까지 반복)
//   node scripts/cron.mjs video     영상 1단계(키워드→검색→아웃라이어)
//   node scripts/cron.mjs analyze   영상 2단계(자막·썸네일·첫15초·종합)
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
async function reddit() {
  for (let i = 1; i <= 40; i++) {
    const r = await call("/api/cron/tick");
    log(`tick ${i}`, JSON.stringify(r).slice(0, 200));
    if (r?.stoppedBecause === "stalled") throw new Error(`stalled: ${r.error ?? ""}`);
    const { next } = await call("/api/cron/tick?peek=1");
    if (next === "idle") return log("idle 도달");
  }
  throw new Error("40회를 돌고도 idle에 도달하지 못했다 — 조건을 확인할 것");
}

const jobs = {
  reddit,
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
