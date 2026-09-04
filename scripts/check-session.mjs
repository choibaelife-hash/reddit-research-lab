// 세션 서명 자체 점검.  node scripts/check-session.mjs
import assert from "node:assert/strict";

process.env.SESSION_SECRET = "테스트용-비밀-문자열";
const { signSession, verifySession } = await import("../lib/session.mjs");

const uid = "11111111-2222-3333-4444-555555555555";
const token = await signSession(uid);

assert.equal(await verifySession(token), uid, "정상 토큰을 거절했다");
assert.equal(await verifySession(undefined), null, "빈 토큰을 통과시켰다");
assert.equal(await verifySession(""), null, "빈 문자열을 통과시켰다");
assert.equal(await verifySession(uid), null, "서명 없는 값을 통과시켰다");

// 서명을 한 글자 바꾸면 반드시 거절돼야 한다. 여기가 뚫리면 아무나 남의 계정이 된다.
const tampered = token.slice(0, -1) + (token.at(-1) === "a" ? "b" : "a");
assert.equal(await verifySession(tampered), null, "위조된 서명을 통과시켰다");

// 사용자 아이디만 바꿔치기하는 시도 — 서명이 안 맞으므로 거절돼야 한다.
const other = "99999999-9999-9999-9999-999999999999" + token.slice(token.lastIndexOf("."));
assert.equal(await verifySession(other), null, "아이디 바꿔치기를 통과시켰다");

// 비밀키가 없으면 아무도 못 들어와야 한다(열려 있으면 안 된다).
// verifySession은 호출할 때마다 환경변수를 다시 읽으므로 모듈을 다시 불러올 필요가 없다.
delete process.env.SESSION_SECRET;
assert.equal(await verifySession(token), null, "SESSION_SECRET 없이 통과시켰다");

console.log("✔ session 점검 통과");
