import { NextRequest, NextResponse } from "next/server";
import { ingestItems, type IngestItem } from "@/lib/ingest";

export async function POST(req: NextRequest) {
  const apiKey = req.headers.get("x-api-key");
  if (!apiKey || apiKey !== process.env.N8N_INGEST_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const source = body?.source;
  const items: IngestItem[] = body?.items;

  if (typeof source !== "string" || !Array.isArray(items)) {
    return NextResponse.json({ error: "invalid payload" }, { status: 400 });
  }

  const result = await ingestItems(source, items);
  return NextResponse.json(result);
}
