import Parser from "rss-parser";
import { pool } from "@/lib/db";
import { ingestItems, type IngestItem } from "@/lib/ingest";

const parser = new Parser({ timeout: 15000 });

export type CollectResult = {
  ok: number;
  failed: number;
  totalInserted: number;
  totalSkipped: number;
  totalNewKeywords: number;
  perSource: Record<string, string>;
};

export async function collectRss(): Promise<CollectResult> {
  const rules = await pool.query(
    `select value, category from collection_rules where source = 'rss' and enabled = true`
  );

  let ok = 0;
  let failed = 0;
  let totalInserted = 0;
  let totalSkipped = 0;
  let totalNewKeywords = 0;
  const perSource: Record<string, string> = {};
  const perCategory: Record<string, { ok: number; inserted: number }> = {};

  for (const rule of rules.rows) {
    const stats = (perCategory[rule.category] ??= { ok: 0, inserted: 0 });
    try {
      const feed = await parser.parseURL(rule.value);
      const items: IngestItem[] = feed.items
        .filter((it) => it.link)
        .map((it) => ({
          external_id: it.link!,
          keyword_hint: it.title ?? it.link!,
          category: rule.category,
          url: it.link,
          title: it.title,
          occurred_at: it.isoDate ?? it.pubDate ?? new Date().toISOString(),
          raw: { feed: feed.title ?? rule.value, contentSnippet: it.contentSnippet ?? null },
        }));

      const result = await ingestItems("rss", items);
      totalInserted += result.inserted;
      totalSkipped += result.skipped_duplicate;
      totalNewKeywords += result.new_keywords;
      ok++;
      stats.ok++;
      stats.inserted += result.inserted;
      perSource[rule.value] = `ok (${result.inserted} new)`;
    } catch (err) {
      failed++;
      perSource[rule.value] = `failed: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  for (const [category, stats] of Object.entries(perCategory)) {
    await updateSourceStatus("rss", category, stats.ok > 0, stats.inserted);
  }
  return { ok, failed, totalInserted, totalSkipped, totalNewKeywords, perSource };
}

export async function updateSourceStatus(source: string, category: string, anySuccess: boolean, count: number) {
  await pool.query(
    `insert into source_status (source, category, last_attempt_at, last_success_at, last_count, consecutive_fails, state)
     values ($1, $2, now(), case when $3 then now() else null end, $4, 0, 'ok')
     on conflict (source, category) do update set
       last_attempt_at = now(),
       last_success_at = case when $3 then now() else source_status.last_success_at end,
       last_count = $4,
       consecutive_fails = case when $3 then 0 else source_status.consecutive_fails + 1 end,
       state = case
         when $3 then 'ok'
         when source_status.consecutive_fails + 1 >= 5 then 'down'
         when source_status.consecutive_fails + 1 >= 3 then 'degraded'
         else 'ok'
       end`,
    [source, category, anySuccess, count]
  );
}
