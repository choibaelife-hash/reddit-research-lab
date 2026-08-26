import Parser from "rss-parser";
import { pool } from "@/lib/db";

// 글 하나당 댓글은 요청 1번이다. 실측상 매 요청이 429에 걸려 백오프까지 약 1분/건이라
// Vercel 함수 한도(300초) 안에서는 5건 정도가 한계다. 그래서 "아직 댓글이 없는 상위 글"만 골라 처리한다.

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";
const parser = new Parser({ timeout: 25000, headers: { "User-Agent": UA } });

const PER_RUN = 5;
const TOP_N = 5; // 글당 저장할 댓글 수 — 상위 5개면 핵심이 다 들어온다(실측)
const GAP_MS = 14_000;
const BACKOFF_MS = 40_000;
const DEADLINE_MS = 240_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const isRateLimited = (e: unknown) => /429|Too Many Requests/i.test(String(e));

// AutoModerator 안내문이 상위에 섞인다. 삭제된 댓글도 내용이 없다.
const JUNK = /AutoModerator|\[removed\]|\[deleted\]/i;

function stripHtml(s: string) {
  return s
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchComments(subreddit: string, postId: string, tries = 3) {
  const url = `https://www.reddit.com/r/${subreddit}/comments/${postId}/.rss?sort=top`;
  for (let i = 0; i < tries; i++) {
    try {
      return await parser.parseURL(url);
    } catch (err) {
      if (isRateLimited(err) && i < tries - 1) {
        await sleep(BACKOFF_MS * (i + 1));
        continue;
      }
      throw err;
    }
  }
  throw new Error("unreachable");
}

export type CommentResult = { picked: number; ok: number; failed: number; saved: number; detail: string[] };

export async function collectComments(limit = PER_RUN, perSub = 3): Promise<CommentResult> {
  // 병원 데이터가 목적이라 '시술클리닉 + 추천요청' 글을 먼저 가져온다(clinic_rank).
  // 댓글이 0개여도 comments_checked_at을 남겨야 같은 글이 매번 다시 선택되지 않는다.
  // 정렬을 rn/서브레딧으로 하면 알파벳 앞선 서브레딧의 하위 글이
  // 다른 서브레딧의 상위 글보다 먼저 뽑힌다(실제로 tick이 이것만 4번 반복했다).
  // 반드시 worth 순으로 골라야 "상위 N건 채우기"가 수렴한다.
  const targets = await pool.query<{ id: string; external_id: string; subreddit: string; rank: number; title: string }>(
    `with ranked as (
       select m.id, m.external_id,
              m.raw->>'subreddit' as subreddit,
              (m.raw->>'rank')::int as rank,
              m.title, a.worth,
              -- 순위는 반드시 worth 순이어야 한다. pipeline.nextStep이 "worth 상위 N건"을 기준으로
              -- 남은 일을 세기 때문에, 여기서 다른 기준으로 줄을 세우면 두 목록이 어긋나
              -- 영원히 수렴하지 않는다(실제로 tick이 comments만 7번 반복했다).
              row_number() over (
                partition by m.raw->>'subreddit'
                order by a.worth desc, (m.raw->>'rank')::int asc
              ) as rn,
              -- 병원 이름은 시술클리닉·추천요청 글의 댓글에 몰려 있다.
              -- 선택 집합은 worth로 정하고, 그 안에서의 처리 순서만 이걸로 앞당긴다.
              (case when a.beauty_area = '시술클리닉' then 0 else 1 end) * 2
              + (case when a.post_type in ('추천요청','비교질문') then 0 else 1 end) as clinic_rank
         from mentions m
         join post_analysis a on a.mention_id = m.id
        where m.source = 'reddit' and a.comments_checked_at is null
     )
     select id, external_id, subreddit, rank, title
       from ranked where rn <= $2
      order by clinic_rank, worth desc nulls last, rn
      limit $1`,
    [limit, perSub]
  );

  let ok = 0, failed = 0, saved = 0;
  const detail: string[] = [];
  const startedAt = Date.now();

  for (const [i, t] of targets.rows.entries()) {
    if (Date.now() - startedAt > DEADLINE_MS) {
      detail.push(`skipped(시간초과): r/${t.subreddit} #${t.rank}`);
      continue;
    }
    if (i > 0) await sleep(GAP_MS);

    try {
      const feed = await fetchComments(t.subreddit, t.external_id);
      // 0번 entry는 글 본문이므로 제외
      const rows = feed.items
        .slice(1)
        .map((it) => ({ author: (it.author ?? "").replace(/^\/u\//, ""), body: stripHtml(it.contentSnippet ?? it.content ?? "") }))
        .filter((c) => c.body.length >= 25 && !JUNK.test(c.author) && !JUNK.test(c.body))
        .slice(0, TOP_N);

      for (const [idx, c] of rows.entries()) {
        await pool.query(
          `insert into post_comments (mention_id, rank, author, body)
           values ($1,$2,$3,$4) on conflict (mention_id, rank) do nothing`,
          [t.id, idx + 1, c.author, c.body]
        );
      }
      await pool.query(`update post_analysis set comments_checked_at = now() where mention_id = $1`, [t.id]);
      saved += rows.length;
      ok++;
      detail.push(`ok: r/${t.subreddit} #${t.rank} — 댓글 ${rows.length}개`);
    } catch (err) {
      failed++;
      detail.push(`failed: r/${t.subreddit} #${t.rank} — ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return { picked: targets.rows.length, ok, failed, saved, detail };
}
