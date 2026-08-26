import { NextRequest, NextResponse } from "next/server";
import { buildCards } from "@/lib/analyzers/cards";

export const maxDuration = 300;

export async function GET(req: NextRequest) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const perSub = Number(req.nextUrl.searchParams.get("perSub") ?? 3);
  return NextResponse.json(await buildCards(perSub));
}
