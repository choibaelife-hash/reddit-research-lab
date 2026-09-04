import { NextRequest, NextResponse } from "next/server";

// 크론 라우트의 유일한 방어선.
//
// `proxy.ts`가 /api/는 그냥 통과시키므로(비밀번호 잠금 대상이 아님)
// 여기가 뚫리면 누구나 파이프라인을 돌릴 수 있다 — LLM 비용이 나가고
// 유튜브 하루 할당량이 타버린다.
//
// 두 가지를 막는다.
//  ① `CRON_SECRET`이 없으면 전부 거절한다.
//     예전 코드는 `Bearer ${undefined}`와 비교해서, 환경변수를 빼먹으면
//     "Bearer undefined"를 보내는 쪽이 통과했다. 잠금이 조용히 풀리는 셈이다.
//  ② Vercel 시절의 `x-vercel-cron` 예외를 없앴다. Railway에는 그 헤더를
//     통제해줄 주체가 없어, 헤더만 붙이면 인증을 건너뛸 수 있었다.
//
// 통과하면 null, 막히면 응답을 돌려준다.
export function denyCron(req: NextRequest): NextResponse | null {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "CRON_SECRET 미설정 — 크론을 열어둘 수 없어 거절한다" },
      { status: 503 }
    );
  }
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return null;
}
