import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/session.mjs";

// 로그인 검사. 세션 쿠키의 서명만 본다(미들웨어는 DB에 못 붙는다).
//
// 예전에는 BOARD_PASSWORD 하나로 잠갔다. 계정 개념이 없어서
// 누가 들어왔는지 알 수 없었고, 데이터를 사람별로 나눌 수도 없었다.
//
// 크론 라우트는 Bearer 토큰으로 따로 인증한다(lib/cron-auth.ts). 여기서 통과시킨다.
export default async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (pathname.startsWith("/api/") || pathname.startsWith("/login") || pathname.startsWith("/_next")) {
    return NextResponse.next();
  }

  if (await verifySession(req.cookies.get(SESSION_COOKIE)?.value)) {
    return NextResponse.next();
  }

  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname + req.nextUrl.search)}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
