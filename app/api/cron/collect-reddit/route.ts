import { NextRequest, NextResponse } from "next/server";
import { denyCron } from "@/lib/cron-auth";
import { collectReddit } from "@/lib/collectors/reddit";


export async function GET(req: NextRequest) {
  const denied = denyCron(req);
  if (denied) return denied;

  const result = await collectReddit();
  return NextResponse.json(result);
}
