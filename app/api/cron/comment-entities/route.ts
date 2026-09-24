import { NextRequest, NextResponse } from "next/server";
import { denyCron } from "@/lib/cron-auth";
import { extractCommentEntities } from "@/lib/analyzers/comment-entities";
import { revalidateTag } from "next/cache";


export async function GET(req: NextRequest) {
  const denied = denyCron(req);
  if (denied) return denied;
  const limit = Number(req.nextUrl.searchParams.get("limit") ?? 60);
  try {
    return NextResponse.json(await extractCommentEntities(limit));
  } finally {
    revalidateTag("board-data", { expire: 0 });
  }
}
