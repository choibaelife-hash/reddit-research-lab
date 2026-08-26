import { NextRequest, NextResponse } from "next/server";
import { collectReddit } from "@/lib/collectors/reddit";

// 서브레딧 5개를 12초 간격으로 순차 수집(약 1분) + 429 백오프 여유
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const result = await collectReddit();
  return NextResponse.json(result);
}
