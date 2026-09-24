import { NextRequest, NextResponse } from "next/server";
import { denyCron } from "@/lib/cron-auth";
import { buildCards } from "@/lib/analyzers/cards";
import { revalidateTag } from "next/cache";


export async function GET(req: NextRequest) {
  const denied = denyCron(req);
  if (denied) return denied;
  const perSub = Number(req.nextUrl.searchParams.get("perSub") ?? 3);
  try {
    return NextResponse.json(await buildCards(perSub));
  } finally {
    revalidateTag("board-data", { expire: 0 });
  }
}
