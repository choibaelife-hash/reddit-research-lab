import { NextRequest, NextResponse } from "next/server";
import { denyCron } from "@/lib/cron-auth";
import { collectRss } from "@/lib/collectors/rss";

export async function GET(req: NextRequest) {
  const denied = denyCron(req);
  if (denied) return denied;

  const result = await collectRss();
  return NextResponse.json(result);
}
