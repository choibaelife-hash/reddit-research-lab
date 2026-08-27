import { NextRequest, NextResponse } from "next/server";
import { runVideo } from "@/lib/video/run";

export const maxDuration = 300;

export async function GET(req: NextRequest) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const limit = Number(req.nextUrl.searchParams.get("limit") ?? 5);
  const week = req.nextUrl.searchParams.get("week") ?? undefined;
  try {
    return NextResponse.json(await runVideo({ week, limit }));
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message ?? e) }, { status: 500 });
  }
}
