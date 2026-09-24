import { NextRequest, NextResponse } from "next/server";
import { ingestItems, type IngestItem } from "@/lib/ingest";
import { revalidateTag } from "next/cache";

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

  try {
    return NextResponse.json(await ingestItems(source, items));
  } finally {
    revalidateTag("board-data", { expire: 0 });
  }
}
