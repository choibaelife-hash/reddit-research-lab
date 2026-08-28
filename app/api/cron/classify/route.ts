import { NextRequest, NextResponse } from "next/server";
import { denyCron } from "@/lib/cron-auth";
import { classifyPosts } from "@/lib/analyzers/classify";


export async function GET(req: NextRequest) {
  const denied = denyCron(req);
  if (denied) return denied;
  const limit = Number(req.nextUrl.searchParams.get("limit") ?? 200);
  return NextResponse.json(await classifyPosts(limit));
}
