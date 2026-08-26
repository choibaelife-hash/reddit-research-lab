import { NextRequest, NextResponse } from "next/server";
import { extractRelevance } from "@/lib/analyzers/korea-relevance";
import { rescoreAll } from "@/lib/analyzers/score";

export const maxDuration = 300;

export async function GET(req: NextRequest) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  // 한국 관련도(LLM)를 먼저 채우고, 그다음 전체 재계산
  const relevance = await extractRelevance(
    Number(req.nextUrl.searchParams.get("limit") ?? 200),
    req.nextUrl.searchParams.get("force") === "1"
  );
  const score = await rescoreAll();
  return NextResponse.json({ relevance, score });
}
