import { NextRequest, NextResponse } from "next/server";
import { classifyPosts } from "@/lib/analyzers/classify";

export const maxDuration = 300;

export async function GET(req: NextRequest) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const limit = Number(req.nextUrl.searchParams.get("limit") ?? 200);
  return NextResponse.json(await classifyPosts(limit));
}
