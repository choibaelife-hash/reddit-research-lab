import { NextRequest, NextResponse } from "next/server";
import { denyCron } from "@/lib/cron-auth";
import { extractCommentEntities } from "@/lib/analyzers/comment-entities";


export async function GET(req: NextRequest) {
  const denied = denyCron(req);
  if (denied) return denied;
  const limit = Number(req.nextUrl.searchParams.get("limit") ?? 60);
  return NextResponse.json(await extractCommentEntities(limit));
}
