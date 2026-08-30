// 비밀번호 해시. 새 라이브러리(bcrypt·argon2)를 깔지 않고 Node 기본 모듈로 한다.
//
// scrypt는 일부러 느리게 계산되도록 설계된 함수다. 비밀번호를 평문으로 저장하면
// DB가 새는 순간 고객 비밀번호가 그대로 털린다. 해시로 저장하면 되돌릴 수 없다.
//
// 저장 형식:  scrypt:<소금 16바이트 hex>:<해시 64바이트 hex>
// 소금(salt)을 계정마다 다르게 두는 이유 — 같은 비밀번호를 쓰는 두 계정이
// DB에서 똑같아 보이면, 하나가 뚫릴 때 나머지도 같이 뚫린다.
import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt);

/** @param {string} plain @returns {Promise<string>} */
export async function hashPassword(plain) {
  const salt = randomBytes(16);
  const key = /** @type {Buffer} */ (await scryptAsync(plain, salt, 64));
  return `scrypt:${salt.toString("hex")}:${key.toString("hex")}`;
}

/**
 * @param {string} plain @param {string} stored
 * @returns {Promise<boolean>}
 */
export async function verifyPassword(plain, stored) {
  const [algo, saltHex, keyHex] = String(stored ?? "").split(":");
  if (algo !== "scrypt" || !saltHex || !keyHex) return false;

  let expected;
  try {
    expected = Buffer.from(keyHex, "hex");
  } catch {
    return false;
  }
  if (expected.length !== 64) return false;

  const key = /** @type {Buffer} */ (await scryptAsync(plain, Buffer.from(saltHex, "hex"), 64));
  // 일반 === 비교는 앞에서부터 다른 글자가 나오면 즉시 멈춘다. 그 미세한 시간 차이로
  // 해시를 한 글자씩 알아낼 수 있다. timingSafeEqual은 항상 끝까지 비교한다.
  return timingSafeEqual(key, expected);
}
