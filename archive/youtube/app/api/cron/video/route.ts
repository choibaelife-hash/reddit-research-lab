import { NextRequest, NextResponse } from "next/server";
import { denyCron } from "@/lib/cron-auth";
import { runVideo } from "@/lib/video/run";


export async function GET(req: NextRequest) {
  const denied = denyCron(req);
  if (denied) return denied;
  const limit = Number(req.nextUrl.searchParams.get("limit") ?? 3);
  const week = req.nextUrl.searchParams.get("week") ?? undefined;
  const workspaceId = req.nextUrl.searchParams.get("ws") ?? undefined;
  try {
    return NextResponse.json(await runVideo({ week, limit, workspaceId }));
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message ?? e) }, { status: 500 });
  }
}
