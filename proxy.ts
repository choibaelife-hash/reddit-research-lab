import { NextRequest, NextResponse } from "next/server";

// 개인용 잠금장치.
// 배포하면 /board가 인터넷에 열리므로 비밀번호 하나로 막는다.
// 크론 라우트는 Bearer 토큰으로 따로 인증하므로 여기서 통과시킨다.

export const COOKIE = "board_auth";

// 쿠키에는 비밀번호 자체가 아니라 해시를 담는다. 쿠키를 훔쳐도 비밀번호는 모른다.
export async function tokenFor(password: string) {
  const data = new TextEncoder().encode(`museofseoul:${password}`);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export default async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // 크론은 Authorization 헤더로 인증한다. 로그인 화면과 정적 파일도 통과.
  if (pathname.startsWith("/api/") || pathname.startsWith("/login") || pathname.startsWith("/_next")) {
    return NextResponse.next();
  }

  const expected = process.env.BOARD_PASSWORD;
  // 비밀번호를 설정하지 않았으면 잠그지 않는다 (로컬 개발용).
  if (!expected) return NextResponse.next();

  const got = req.cookies.get(COOKIE)?.value;
  if (got && got === (await tokenFor(expected))) return NextResponse.next();

  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname + req.nextUrl.search)}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
