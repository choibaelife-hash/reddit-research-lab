import { NextRequest, NextResponse } from "next/server";
import { denyCron } from "@/lib/cron-auth";
import { collectComments } from "@/lib/collectors/reddit-comments";

// 글 1건당 약 1분(429 백오프 포함) — 한 번에 5건이 한도 안에서 안전한 최대

export async function GET(req: NextRequest) {
  const denied = denyCron(req);
  if (denied) return denied;
  const limit = Number(req.nextUrl.searchParams.get("limit") ?? 5);
  const perSub = Number(req.nextUrl.searchParams.get("perSub") ?? 3);
  return NextResponse.json(await collectComments(limit, perSub));
}
