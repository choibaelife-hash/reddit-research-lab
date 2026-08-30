// 비밀번호 해시. 새 라이브러리(bcrypt·argon2)를 깔지 않고 Node 기본 모듈로 한다.
//
// scrypt는 일부러 느리고 메모리를 많이 쓰도록 설계된 함수다. 비밀번호를 평문으로 저장하면
// DB가 새는 순간 고객 비밀번호가 그대로 털린다. 해시로 저장하면 되돌릴 수 없다.
//
// 저장 형식:  scrypt:<N>:<소금 16바이트 hex>:<해시 64바이트 hex>
//
// N을 형식에 적어 두는 이유 — N은 "얼마나 세게 계산했나"다. 이걸 안 적으면
// 나중에 N을 올리는 순간 기존 고객의 해시를 검증할 수 없어, 전원이 아무 에러 없이
// 로그인에 실패한다. 적어 두면 옛 해시는 옛 N으로 검증되고 새 해시만 새 N을 쓴다.
//
// 소금(salt)을 계정마다 다르게 두는 이유 — 같은 비밀번호를 쓰는 두 계정이
// DB에서 똑같아 보이면, 하나가 뚫릴 때 나머지도 같이 뚫린다.
import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt);

// 새로 만드는 해시의 강도. 실측(2026-08-30): 220ms / 64MB.
// Node 기본값은 16384(50ms/16MB)인데 OWASP 2026 권고 최소는 131072(461ms/128MB)다.
// 128MB는 로그인 몇 건이 겹치면 작은 컨테이너가 죽을 수 있어 중간을 골랐다.
// 올리려면 이 숫자만 바꾸면 된다 — 형식에 N이 들어 있어 기존 해시는 그대로 검증된다.
const N = 65536;

// 저장된 값에서 N을 읽어 그대로 쓰므로 범위를 막아야 한다.
// DB에 쓸 수 있는 공격자가 N을 2^30으로 바꿔 두면 로그인 한 번에 서버 메모리가 터진다.
const N_MIN = 16384;    // 2^14 — Node 기본값. 이보다 약한 건 받지 않는다
const N_MAX = 1048576;  // 2^20 — 이보다 크면 정상적인 값이 아니다

// maxmem 기본값이 32MB라 N을 올리면 넘겨줘야 한다. scrypt는 128·N·r 바이트를 쓴다.
const opts = (n) => ({ N: n, r: 8, p: 1, maxmem: 128 * n * 8 * 2 });

/** @param {string} plain @returns {Promise<string>} */
export async function hashPassword(plain) {
  const salt = randomBytes(16);
  const key = /** @type {Buffer} */ (await scryptAsync(plain, salt, 64, opts(N)));
  return `scrypt:${N}:${salt.toString("hex")}:${key.toString("hex")}`;
}

/**
 * @param {string} plain @param {string} stored
 * @returns {Promise<boolean>}
 */
export async function verifyPassword(plain, stored) {
  const [algo, nStr, saltHex, keyHex] = String(stored ?? "").split(":");
  if (algo !== "scrypt" || !nStr || !saltHex || !keyHex) return false;

  // N은 저장된 값에서 읽는다. 2의 거듭제곱이어야 하고 범위 안이어야 한다.
  const n = Number(nStr);
  if (!Number.isInteger(n) || n < N_MIN || n > N_MAX || (n & (n - 1)) !== 0) return false;

  // Buffer.from은 잘못된 hex에서 예외를 던지지 않고 조용히 잘라낸다.
  // 길이로 걸러야 timingSafeEqual이 RangeError를 던지지 않는다.
  const expected = Buffer.from(keyHex, "hex");
  const salt = Buffer.from(saltHex, "hex");
  if (expected.length !== 64 || salt.length !== 16) return false;

  const key = /** @type {Buffer} */ (await scryptAsync(plain, salt, 64, opts(n)));
  // 일반 === 비교는 앞에서부터 다른 글자가 나오면 즉시 멈춘다. 그 미세한 시간 차이로
  // 해시를 한 글자씩 알아낼 수 있다. timingSafeEqual은 항상 끝까지 비교한다.
  return timingSafeEqual(key, expected);
}
