import { NextRequest, NextResponse } from "next/server";
import { denyCron } from "@/lib/cron-auth";
import { collectReddit } from "@/lib/collectors/reddit";
import { revalidateTag } from "next/cache";


export async function GET(req: NextRequest) {
  const denied = denyCron(req);
  if (denied) return denied;

  try {
    return NextResponse.json(await collectReddit());
  } finally {
    revalidateTag("board-data", { expire: 0 });
  }
}
