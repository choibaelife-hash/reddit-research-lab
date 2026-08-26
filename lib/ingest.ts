import { pool } from "@/lib/db";

export type IngestItem = {
  external_id: string;
  keyword_hint: string;
  category: string;
  url?: string;
  title?: string;
  occurred_at: string;
  raw?: Record<string, unknown>;
};

export type IngestResult = {
  inserted: number;
  skipped_duplicate: number;
  new_keywords: number;
};

export async function ingestItems(source: string, items: IngestItem[]): Promise<IngestResult> {
  let inserted = 0;
  let skipped_duplicate = 0;
  let new_keywords = 0;

  for (const item of items) {
    if (!item?.external_id || !item?.keyword_hint || !item?.category || !item?.occurred_at) {
      continue; // ponytail: malformed item skipped silently, add per-item error report if a caller needs it later
    }

    const existing = await pool.query(
      `select id from keywords where category = $1 and lower(label) = lower($2) and status != 'archived' limit 1`,
      [item.category, item.keyword_hint]
    );

    let keywordId: string;
    if (existing.rows.length > 0) {
      keywordId = existing.rows[0].id;
    } else {
      const created = await pool.query(
        `insert into keywords (label, category, status, created_by) values ($1, $2, 'candidate', 'auto') returning id`,
        [item.keyword_hint, item.category]
      );
      keywordId = created.rows[0].id;
      new_keywords++;
    }

    const mention = await pool.query(
      `insert into mentions (keyword_id, source, external_id, url, title, raw, occurred_at)
       values ($1, $2, $3, $4, $5, $6, $7)
       on conflict (source, external_id) do nothing
       returning id`,
      [keywordId, source, item.external_id, item.url ?? null, item.title ?? null, item.raw ?? {}, item.occurred_at]
    );

    if (mention.rows.length > 0) {
      inserted++;
    } else {
      skipped_duplicate++;
    }
  }

  return { inserted, skipped_duplicate, new_keywords };
}
