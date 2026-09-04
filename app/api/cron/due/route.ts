import { NextRequest, NextResponse } from "next/server";
import { denyCron } from "@/lib/cron-auth";
import { dueWorkspaces } from "@/lib/schedule";

// "지금 돌 차례인 워크스페이스가 누구냐"만 답한다. 실행은 안 한다.
//
// Railway 크론(scripts/cron.mjs due)이 매시간 이걸 먼저 물어보고,
// 나온 워크스페이스만 골라 수집·분석을 돌린다.
// 이 구조 덕분에 Railway 크론은 고객이 100명이 돼도 영원히 1개다.

export async function GET(req: NextRequest) {
  const denied = denyCron(req);
  if (denied) return denied;

  // 한 번에 몇 개까지 볼지. 레딧은 IP 제한이 있어 동시에 여러 개를 못 돌린다.
  // 못 한 것은 다음 시간에 잡힌다 — 아직 그 시각이니까.
  const limit = Number(req.nextUrl.searchParams.get("limit") ?? 3);
  return NextResponse.json({ due: await dueWorkspaces(limit) });
}
