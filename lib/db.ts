import { Pool } from "pg";

declare global {
  var _pgPool: Pool | undefined;
}

// Vercel(서버리스)에서는 요청이 끝나면 프로세스가 죽어 커넥션도 같이 사라졌다.
// Railway는 프로세스가 계속 살아 있어 **풀이 커넥션을 계속 붙잡고 있는다**(2026-08-28).
// 관리형 Postgres는 동시 접속 수에 상한이 있으므로 크기를 명시해 둔다.
//
//   max                동시 커넥션 상한. 웹 1대 기준으로 넉넉하다.
//                      DB 플랜의 상한을 넘지 않도록 배포 후 확인할 것.
//   idleTimeoutMillis  놀고 있는 커넥션을 30초 뒤 반납한다. 주간 배치라 대부분 놀고 있다.
//   connectionTimeout   DB가 응답 없을 때 영원히 매달리지 않는다.
export const pool =
  global._pgPool ??
  new Pool({
    connectionString: process.env.DATABASE_URL,
    max: Number(process.env.PG_POOL_MAX ?? 10),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });

// 풀이 죽어도 프로세스를 끌어내리지 않는다. 상주 프로세스에서는 이게 없으면
// 커넥션 하나가 끊길 때 서버 전체가 내려간다.
pool.on("error", (err) => {
  console.error("[db] 유휴 커넥션 오류:", err.message);
});

// 개발 중에는 파일을 고칠 때마다 모듈이 다시 읽혀 풀이 계속 새로 생긴다. 하나만 쓴다.
if (process.env.NODE_ENV !== "production") {
  global._pgPool = pool;
}
