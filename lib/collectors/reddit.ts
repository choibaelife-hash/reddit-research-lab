import Parser from "rss-parser";
import { pool } from "@/lib/db";
import { ingestItems, type IngestItem } from "@/lib/ingest";
import { updateSourceStatus, type CollectResult } from "@/lib/collectors/rss";

// Apify 액터 → 레딧 공개 RSS로 교체(2026-08-25).
// 이유: Apify 한도 소진 + 공식 API 발급 불가. 레딧 RSS는 인증 없이 무료이고,
// Apify가 못 주던 본문/정확한 게시시각까지 준다. 대신 업보트 수는 안 나온다.
// 업보트 대신 top 정렬의 "순위"를 화제성 신호로 저장한다.

// 레딧은 기본 UA(rss-parser 등)를 403으로 막는다 — 브라우저 UA 명시 필수(실측 확인)
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";
const parser = new Parser({ timeout: 25000, headers: { "User-Agent": UA } });

const DEFAULT_PERIOD = "week";
// ponytail: 서브레딧 간 간격. 무간격 연속 호출은 5개 전부 429였고 12초 간격은 전부 성공(실측).
// 5개 × 12초 = 약 1분으로 Vercel 함수 300초 한도 안에 충분히 들어간다.
const GAP_MS = 12_000;
const RATE_LIMIT_BACKOFF_MS = 30_000;
const MAX_BODY_CHARS = 3000;
// 429 백오프가 여러 번 겹치면 함수 한도(300초)를 넘길 수 있다.
// 한도에 걸려 강제 종료되면 source_status 갱신이 통째로 날아가므로, 남은 서브레딧은 건너뛰고 정상 종료한다.
const DEADLINE_MS = 240_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const isRateLimited = (err: unknown) => /429|Too Many Requests/i.test(String(err));

async function fetchSubreddit(subreddit: string, period: string, tries = 3) {
  const url = `https://www.reddit.com/r/${subreddit}/top/.rss?t=${period}`;
  for (let attempt = 0; attempt < tries; attempt++) {
    try {
      return await parser.parseURL(url);
    } catch (err) {
      if (isRateLimited(err) && attempt < tries - 1) {
        await sleep(RATE_LIMIT_BACKOFF_MS * (attempt + 1));
        continue;
      }
      throw err;
    }
  }
  throw new Error("unreachable");
}

export async function collectReddit(): Promise<CollectResult> {
  const [rulesRes, excludesRes] = await Promise.all([
    pool.query<{ value: string; category: string; options: { period?: string } | null }>(
      `select value, category, options from collection_rules where source = 'reddit' and enabled = true order by value`
    ),
    pool.query<{ value: string }>(`select value from title_excludes where enabled = true`),
  ]);

  // 기존엔 화면에서 표시할 때만 걸러서 정기 게시판 글이 DB에 그대로 쌓였다 → 수집 시점에 거른다
  const excludes = excludesRes.rows.map((e) => e.value.toLowerCase());
  const isExcluded = (title: string) => excludes.some((term) => title.toLowerCase().includes(term));

  // 레딧이 지운 글은 본문 자리에 안내문만 남는다. 분석에 쓸 수 없으니 저장하지 않는다.
  const REMOVED = /removed by reddit|제거된 게시물|\[removed\]|\[deleted\]|this post was removed/i;

  let ok = 0;
  let failed = 0;
  let totalInserted = 0;
  let totalSkipped = 0;
  let totalNewKeywords = 0;
  const perSource: Record<string, string> = {};
  const perCategory: Record<string, { ok: number; inserted: number }> = {};

  // 레이트리밋 때문에 반드시 순차 실행 (기존 Apify 버전은 Promise.all 병렬이었다)
  const startedAt = Date.now();
  for (const [i, rule] of rulesRes.rows.entries()) {
    const period = rule.options?.period ?? DEFAULT_PERIOD;
    const stats = (perCategory[rule.category] ??= { ok: 0, inserted: 0 });

    if (Date.now() - startedAt > DEADLINE_MS) {
      failed++;
      perSource[rule.value] = "skipped: 시간 초과 — 수동 실행으로 다시 수집하세요";
      continue;
    }
    if (i > 0) await sleep(GAP_MS);

    try {
      const feed = await fetchSubreddit(rule.value, period);

      const items: IngestItem[] = feed.items
        .map((it, idx) => ({ it, rank: idx + 1 })) // top 정렬 순서 = 화제성 순위
        .filter(({ it }) => it.link && it.title && !isExcluded(it.title))
        .filter(({ it }) => !REMOVED.test(it.contentSnippet ?? "") && !REMOVED.test(it.title ?? ""))
        .map(({ it, rank }) => ({
          // 레딧 Atom id는 "t3_1vvuipf" 형태 — 접두사를 떼서 게시물 id만 저장
          external_id: (it.id ?? it.link!).replace(/^t3_/, ""),
          // ponytail: keyword_hint는 아직 제목 그대로. 토픽 정규화(다음 단계)에서 실제 제품·주제명으로 교체된다.
          keyword_hint: it.title!,
          category: rule.category,
          url: it.link,
          title: it.title,
          occurred_at: it.isoDate ?? it.pubDate ?? new Date().toISOString(),
          raw: {
            subreddit: rule.value,
            rank,
            period,
            author: it.author ?? null,
            // contentSnippet은 rss-parser가 HTML을 이미 제거해준 본문 — 토픽 추출용
            body: (it.contentSnippet ?? "").slice(0, MAX_BODY_CHARS),
          },
        }));

      const excluded = feed.items.length - items.length;
      const result = await ingestItems("reddit", items);

      totalInserted += result.inserted;
      totalSkipped += result.skipped_duplicate;
      totalNewKeywords += result.new_keywords;
      ok++;
      stats.ok++;
      stats.inserted += result.inserted;
      perSource[rule.value] =
        `ok (${result.inserted} new / ${feed.items.length}건 중 ${excluded}건 제외, t=${period})`;
    } catch (err) {
      failed++;
      perSource[rule.value] = `failed: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  for (const [category, stats] of Object.entries(perCategory)) {
    await updateSourceStatus("reddit", category, stats.ok > 0, stats.inserted);
  }
  return { ok, failed, totalInserted, totalSkipped, totalNewKeywords, perSource };
}
