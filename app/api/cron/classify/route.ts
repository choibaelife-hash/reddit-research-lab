import { NextRequest, NextResponse } from "next/server";
import { denyCron } from "@/lib/cron-auth";
import { classifyPosts } from "@/lib/analyzers/classify";
import { revalidateTag } from "next/cache";


export async function GET(req: NextRequest) {
  const denied = denyCron(req);
  if (denied) return denied;
  const limit = Number(req.nextUrl.searchParams.get("limit") ?? 200);
  try {
    return NextResponse.json(await classifyPosts(limit));
  } finally {
    revalidateTag("board-data", { expire: 0 });
  }
}
