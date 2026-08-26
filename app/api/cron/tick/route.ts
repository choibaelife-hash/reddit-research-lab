import { NextRequest, NextResponse } from "next/server";
import { tick, nextStep } from "@/lib/pipeline";

export const maxDuration = 300;

export async function GET(req: NextRequest) {
  // Vercel 크론은 자체 헤더를 붙여 호출한다. 수동 호출은 Bearer로 인증한다.
  const auth = req.headers.get("authorization");
  const isVercelCron = req.headers.get("x-vercel-cron") !== null;
  if (!isVercelCron && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // ?peek=1 이면 실행하지 않고 다음 단계만 알려준다 (상태 확인용)
  if (req.nextUrl.searchParams.get("peek") === "1") {
    return NextResponse.json({ next: await nextStep() });
  }

  return NextResponse.json(await tick());
}
