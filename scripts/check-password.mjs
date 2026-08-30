// 비밀번호 해시 자체 점검.  node scripts/check-password.mjs
import assert from "node:assert/strict";
import { hashPassword, verifyPassword } from "../lib/password.mjs";

const stored = await hashPassword("올바른비밀번호");

assert.match(stored, /^scrypt:[0-9a-f]{32}:[0-9a-f]{128}$/, "저장 형식이 scrypt:소금:해시가 아니다");
assert.equal(await verifyPassword("올바른비밀번호", stored), true, "맞는 비밀번호가 거절됐다");
assert.equal(await verifyPassword("틀린비밀번호", stored), false, "틀린 비밀번호가 통과했다");
assert.equal(await verifyPassword("", stored), false, "빈 비밀번호가 통과했다");

// 소금이 매번 달라야 한다. 같으면 같은 비밀번호를 쓰는 두 계정이 DB에서 똑같아 보인다.
assert.notEqual(await hashPassword("같은비밀번호"), await hashPassword("같은비밀번호"), "소금이 고정돼 있다");

// 형식이 깨진 값에 터지지 않고 false를 줘야 한다.
for (const junk of ["", "그냥문자열", "bcrypt:aa:bb", "scrypt:zz:zz"]) {
  assert.equal(await verifyPassword("아무거나", junk), false, `형식 오류를 통과시켰다: ${junk}`);
}

console.log("✔ password 점검 통과");
