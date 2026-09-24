import { NextRequest, NextResponse } from "next/server";
import { denyCron } from "@/lib/cron-auth";
import { collectRss } from "@/lib/collectors/rss";
import { revalidateTag } from "next/cache";

export async function GET(req: NextRequest) {
  const denied = denyCron(req);
  if (denied) return denied;

  try {
    return NextResponse.json(await collectRss());
  } finally {
    revalidateTag("board-data", { expire: 0 });
  }
}
