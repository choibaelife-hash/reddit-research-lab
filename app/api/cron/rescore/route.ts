import { NextRequest, NextResponse } from "next/server";
import { denyCron } from "@/lib/cron-auth";
import { extractRelevance } from "@/lib/analyzers/korea-relevance";
import { rescoreAll } from "@/lib/analyzers/score";


export async function GET(req: NextRequest) {
  const denied = denyCron(req);
  if (denied) return denied;
  // 한국 관련도(LLM)를 먼저 채우고, 그다음 전체 재계산
  const relevance = await extractRelevance(
    Number(req.nextUrl.searchParams.get("limit") ?? 200),
    req.nextUrl.searchParams.get("force") === "1"
  );
  const score = await rescoreAll();
  return NextResponse.json({ relevance, score });
}
