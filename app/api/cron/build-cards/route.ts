import { NextRequest, NextResponse } from "next/server";
import { denyCron } from "@/lib/cron-auth";
import { buildCards } from "@/lib/analyzers/cards";


export async function GET(req: NextRequest) {
  const denied = denyCron(req);
  if (denied) return denied;
  const perSub = Number(req.nextUrl.searchParams.get("perSub") ?? 3);
  return NextResponse.json(await buildCards(perSub));
}
