// 비밀번호 해시 자체 점검.  node scripts/check-password.mjs
import assert from "node:assert/strict";
import { randomBytes, scryptSync } from "node:crypto";
import { hashPassword, verifyPassword } from "../lib/password.mjs";

const stored = await hashPassword("올바른비밀번호");

// 형식에 N이 들어 있어야 한다. 없으면 나중에 강도를 올릴 때 기존 고객이 전부 잠긴다.
assert.match(stored, /^scrypt:65536:[0-9a-f]{32}:[0-9a-f]{128}$/, "저장 형식이 scrypt:N:소금:해시가 아니다");
assert.equal(await verifyPassword("올바른비밀번호", stored), true, "맞는 비밀번호가 거절됐다");
assert.equal(await verifyPassword("틀린비밀번호", stored), false, "틀린 비밀번호가 통과했다");
assert.equal(await verifyPassword("", stored), false, "빈 비밀번호가 통과했다");

// 소금이 매번 달라야 한다. 같으면 같은 비밀번호를 쓰는 두 계정이 DB에서 똑같아 보인다.
assert.notEqual(await hashPassword("같은비밀번호"), await hashPassword("같은비밀번호"), "소금이 고정돼 있다");

// 이 점검이 이 파일의 핵심이다.
// 옛 강도로 만들어진 해시도 저장된 N을 읽어 열려야 한다.
// 깨지면 강도를 올리는 순간 기존 고객이 전원 로그인 불가가 된다.
const oldSalt = randomBytes(16);
const oldKey = scryptSync("올바른비밀번호", oldSalt, 64, { N: 16384, r: 8, p: 1 });
const older = `scrypt:16384:${oldSalt.toString("hex")}:${oldKey.toString("hex")}`;
assert.equal(await verifyPassword("올바른비밀번호", older), true, "옛 강도(N=16384) 해시를 못 연다");
assert.equal(await verifyPassword("틀린비밀번호", older), false, "옛 강도 해시가 틀린 비밀번호를 통과시켰다");

// 형식이 깨진 값에 터지지 않고 false를 줘야 한다.
const tail = stored.split(":").slice(2).join(":");
for (const junk of [
  "", "그냥문자열", "bcrypt:aa:bb", "scrypt:zz:zz",
  `scrypt:${tail}`,                 // N이 빠진 옛 형식
  `scrypt:99999:${tail}`,           // 2의 거듭제곱이 아닌 N
  `scrypt:1024:${tail}`,            // 너무 약한 N
  `scrypt:1073741824:${tail}`,      // 2^30 — 메모리 폭탄
  `scrypt:65536::${stored.split(":")[3]}`,  // 소금이 빈 값
]) {
  assert.equal(await verifyPassword("아무거나", junk), false, `형식 오류를 통과시켰다: ${junk.slice(0, 40)}`);
}

console.log("✔ password 점검 통과");
