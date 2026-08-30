// 세션 쿠키. 쿠키 값은 "<사용자아이디>.<서명>"이다.
//
// 서명을 붙이는 이유: 쿠키는 브라우저에 있으니 사용자가 마음대로 고칠 수 있다.
// 아이디만 담으면 남의 아이디로 바꿔 쓰면 그만이다. 서버만 아는 SESSION_SECRET으로
// 서명을 만들어 두면, 값을 고치는 순간 서명이 안 맞아서 거절된다.
//
// DB를 조회하지 않는다. 미들웨어(proxy.ts)에서 검사해야 하는데 미들웨어는
// DB에 붙지 못하기 때문이다. 서명만 맞으면 통과시키고, 실제 사용자 정보는
// 페이지 쪽(lib/workspace.ts)에서 읽는다.
//
// next/headers도 pg도 import하지 않는다. 넣는 순간 미들웨어가 터진다.

export const SESSION_COOKIE = "session";
export const WS_COOKIE = "ws";           // 지금 보고 있는 워크스페이스

/** @returns {string | undefined} */
const secret = () => process.env.SESSION_SECRET || undefined;

/** @param {string} value @returns {Promise<string>} */
async function hmac(value) {
  const s = secret();
  if (!s) throw new Error("SESSION_SECRET 미설정 — 세션을 만들 수 없다");
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(s),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** @param {string} userId @returns {Promise<string>} */
export async function signSession(userId) {
  return `${userId}.${await hmac(userId)}`;
}

/**
 * 유효하면 사용자 아이디, 아니면 null.
 * @param {string | undefined} token @returns {Promise<string | null>}
 */
export async function verifySession(token) {
  // 비밀키가 없으면 아무도 통과시키지 않는다.
  // lib/cron-auth.ts와 같은 원칙 — 잠금이 조용히 풀리는 쪽보다 다 막히는 쪽이 낫다.
  if (!secret() || !token) return null;

  const i = token.lastIndexOf(".");
  if (i <= 0) return null;
  const id = token.slice(0, i);
  const sig = token.slice(i + 1);

  const expected = await hmac(id);
  if (sig.length !== expected.length) return null;
  // 앞글자부터 비교하다 멈추면 시간 차이로 서명을 한 글자씩 알아낼 수 있다. 끝까지 본다.
  let diff = 0;
  for (let k = 0; k < sig.length; k++) diff |= sig.charCodeAt(k) ^ expected.charCodeAt(k);
  return diff === 0 ? id : null;
}
