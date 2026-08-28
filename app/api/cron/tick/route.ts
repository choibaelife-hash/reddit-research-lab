import { NextRequest, NextResponse } from "next/server";
import { denyCron } from "@/lib/cron-auth";
import { tick, nextStep } from "@/lib/pipeline";

export async function GET(req: NextRequest) {
  // Bearer 토큰만 받는다.
  //
  // 예전에는 `x-vercel-cron` 헤더가 있으면 토큰 없이 통과시켰다. Vercel이 그 헤더를
  // 통제해줬기 때문인데, Railway에는 막아줄 주체가 없어 **누구나 헤더만 붙이면
  // 파이프라인을 돌릴 수 있는 구멍**이 된다(LLM 비용 + 유튜브 할당량 소모).
  // 미들웨어도 /api/는 통과시키므로 이 검사가 유일한 방어선이다.
  const denied = denyCron(req);
  if (denied) return denied;

  // ?peek=1 이면 실행하지 않고 다음 단계만 알려준다 (상태 확인용)
  if (req.nextUrl.searchParams.get("peek") === "1") {
    return NextResponse.json({ next: await nextStep() });
  }

  return NextResponse.json(await tick());
}
