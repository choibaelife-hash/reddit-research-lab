import { pool } from "@/lib/db";
import { collectReddit } from "@/lib/collectors/reddit";
import { collectRss } from "@/lib/collectors/rss";
import { collectComments } from "@/lib/collectors/reddit-comments";
import { classifyPosts } from "@/lib/analyzers/classify";
import { extractRelevance } from "@/lib/analyzers/korea-relevance";
import { extractCommentEntities } from "@/lib/analyzers/comment-entities";
import { buildCards } from "@/lib/analyzers/cards";
import { rescoreAll } from "@/lib/analyzers/score";
import { openRun, closeRun, tagRun, defaultWorkspaceId } from "@/lib/runs";
import { weekOf } from "@/lib/schedule";

// 파이프라인 상태 머신.
//
// 크론은 실행 순서를 보장하지 않는다. 그런데 우리는 수집 → 분류 → 댓글 → 카드 순서가 필요하고,
// 댓글은 회당 4~5건이 한계라 여러 번 돌아야 한다.
// 그래서 크론 하나가 "지금 할 일이 뭔지" 스스로 찾아 실행하는 방식으로 간다.
//
// 앞 단계가 안 끝나면 다음으로 안 넘어가므로 순서가 저절로 지켜지고,
// 각 단계가 이미 "아직 처리 안 한 것"만 고르므로 중복 실행해도 API가 재과금되지 않는다.
//
// 한 번 깨어나면 시간이 허락하는 만큼 여러 단계를 이어서 처리한다.
// (Vercel Hobby는 크론이 하루 1회라 한 번에 최대한 진행해야 한다)

// 함수 한도는 300초다. 그런데 데드라인을 "단계 시작 전"에만 보면,
// 4분짜리 단계가 200초 지점에 시작되어 440초에 끝난다(실제로 4.8분이 나왔다).
// 그래서 각 단계의 예상 소요를 미리 빼고 판단한다.
const HARD_LIMIT_MS = 280_000;

const STEP_BUDGET_MS: Record<Step, number> = {
  "collect-reddit": 90_000,    // 서브레딧 4개 × 12초 + 백오프 여유
  "collect-rss": 60_000,
  "classify": 130_000,         // 100건 배치
  "relevance": 100_000,
  "comments": 150_000,         // 글당 약 1분 → 회당 2건
  "comment-entities": 70_000,
  "cards": 100_000,
  "rescore": 20_000,
  idle: 0,
};
const WEEK = "7 days";
// 서브레딧당 댓글을 붙일 상위 글 수. 글당 약 1분이라 전량은 불가능하다.
const COMMENT_TARGET_PER_SUB = 6;
// 서브레딧당 만들 카드 수
const CARDS_PER_SUB = 3;

export type Step =
  | "collect-reddit" | "collect-rss" | "classify" | "relevance"
  | "comments" | "comment-entities" | "cards" | "rescore" | "idle";

const one = async <T>(sql: string, params: any[] = []): Promise<T> =>
  (await pool.query(sql, params)).rows[0] as T;

/** 지금 해야 할 다음 단계 하나를 고른다. */
export async function nextStep(): Promise<Step> {
  // 1) 이번 주 레딧 수집
  const reddit = await one<{ fresh: boolean }>(
    `select exists(select 1 from source_status
       where source = 'reddit' and last_success_at > now() - interval '${WEEK}') as fresh`
  );
  if (!reddit.fresh) return "collect-reddit";

  // 2) 이번 주 RSS 수집 (주 1회로 충분 — 매거진은 4점짜리 보조 신호다)
  const rss = await one<{ fresh: boolean }>(
    `select exists(select 1 from source_status
       where source = 'rss' and last_success_at > now() - interval '${WEEK}') as fresh`
  );
  if (!rss.fresh) return "collect-rss";

  // 3) 분류 안 된 글
  // 조건이 classifyPosts의 실제 대상과 정확히 같아야 한다.
  // 다르면 "할 일 있음 → 0건 처리 → 다시 할 일 있음"으로 무한 루프에 빠진다(실제로 겪었다).
  const unclassified = await one<{ n: number }>(
    `select count(*)::int as n from mentions m
      left join post_analysis a on a.mention_id = m.id
      where m.source = 'reddit' and a.mention_id is null
        and m.raw->>'rank' is not null
        and m.raw->>'subreddit' <> 'muacjdiscussion'`
  );
  if (unclassified.n > 0) return "classify";

  // 4) 한국 관련도(LLM) 미추출 — 점수의 30점을 담당한다
  const noRelevance = await one<{ n: number }>(
    `select count(*)::int as n from post_analysis where kr_relevance is null`
  );
  if (noRelevance.n > 0) return "relevance";

  // 5) 댓글 미수집 상위 글 (병원 이름이 여기서만 나온다)
  // 100건 전부를 쫓으면 글당 1분이라 카드까지 영영 못 간다. 서브레딧별 상위 몇 건만 채운다.
  const noComments = await one<{ n: number }>(
    `with ranked as (
       select a.mention_id,
              row_number() over (partition by m.raw->>'subreddit' order by a.worth desc) as rn
         from post_analysis a join mentions m on m.id = a.mention_id
     )
     select count(*)::int as n
       from ranked r join post_analysis a on a.mention_id = r.mention_id
      where r.rn <= ${COMMENT_TARGET_PER_SUB} and a.comments_checked_at is null`
  );
  if (noComments.n > 0) return "comments";

  // 6) 댓글에서 실체 미추출 — "시도했나"로 판단한다(결과 0개도 시도한 것)
  const noCommentEnts = await one<{ n: number }>(
    `select count(distinct m.id)::int as n from mentions m
      join post_analysis a on a.mention_id = m.id
      join post_comments c on c.mention_id = m.id
      where a.entities_checked_at is null`
  );
  if (noCommentEnts.n > 0) return "comment-entities";

  // 7) 카드 — 서브레딧당 3장이 "이미 있는지"를 본다.
  //
  // 예전엔 "카드 없는 글 중 상위 3건이 있나"로 셌는데, 그러면 12장을 만든 뒤
  // 그다음 12장을 또 만들려 든다(24 → 36 → 무한). gpt-4.1이라 매번 돈이 나간다.
  const needCards = await one<{ n: number }>(
    `select count(*)::int as n from (
       select m.raw->>'subreddit' as sub,
              count(*) filter (where c.mention_id is not null) as have
         from mentions m
         join post_analysis a on a.mention_id = m.id
         left join idea_cards c on c.mention_id = m.id
        group by 1
       having count(*) filter (where c.mention_id is not null) < ${CARDS_PER_SUB}
     ) x`
  );
  if (needCards.n > 0) return "cards";

  // 8) 점수 재계산 — 새 댓글·엔티티가 들어왔으면 가산점이 바뀐다
  const stale = await one<{ n: number }>(
    `select count(*)::int as n from post_analysis a
      where a.scored_at is null
         or a.scored_at < (select max(greatest(
              coalesce((select max(fetched_at) from post_comments), 'epoch'::timestamptz),
              coalesce((select max(created_at) from entity_mentions), 'epoch'::timestamptz))))`
  );
  if (stale.n > 0) return "rescore";

  return "idle";
}

/**
 * 그 단계가 실제로 뭔가 처리했는지 센다.
 *
 * 이게 없어서 무한 루프가 났다. 루프가 "할 일 있나? → 실행" 만 반복하고
 * "실행해서 진짜 진전이 있었나"를 안 봤다.
 * 0건을 처리해도 "했다"고 치고 다시 물어보니, 상태가 그대로라 영원히 돌았다.
 */
function progressOf(step: Step, r: any): number {
  if (!r) return 0;
  switch (step) {
    case "collect-reddit":
    case "collect-rss": return (r.ok ?? 0) + (r.failed ?? 0);
    case "comments": return r.picked ?? 0;
    case "rescore": return r.scored ?? 0;
    default: return (r.done ?? 0) + (r.failed ?? 0);
  }
}

async function runStep(step: Step): Promise<any> {
  switch (step) {
    case "collect-reddit": return collectReddit();
    case "collect-rss": return collectRss();
    case "classify": return classifyPosts(200);
    case "relevance": return extractRelevance(200);
    case "comments": return collectComments(2, 2);
    case "comment-entities": return extractCommentEntities(40);
    case "cards": return buildCards(CARDS_PER_SUB);
    case "rescore": return rescoreAll();
    default: return null;
  }
}

export type TickResult = {
  ran: { step: Step; result: any }[];
  stoppedBecause: "idle" | "deadline" | "stalled" | "error";
  elapsedMs: number;
  nextStep?: Step;   // 시간이 없어 못 한 단계 — 다음 크론이 여기서 이어간다
  error?: string;
};

/**
 * 시간이 허락하는 동안 다음 단계들을 이어서 실행한다.
 *
 * 워크스페이스를 인자로 받는다 — 크론이 "지금 돌 차례인 워크스페이스"를 골라 넘긴다.
 * 안 넘기면 첫 번째를 쓴다(수동 실행·기존 라우트 호환).
 *
 * 주차는 그 워크스페이스의 타임존으로 계산한다. 서버 UTC로 계산하면
 * 한국 월요일 새벽이 UTC로는 일요일이라 지난 주에 들어간다.
 */
export async function tick(workspaceId?: string): Promise<TickResult> {
  const startedAt = Date.now();
  const ran: { step: Step; result: any }[] = [];

  const wsId = workspaceId ?? (await defaultWorkspaceId());
  // 이번 주 실행 줄을 연다. 크론이 여러 번 깨어나도 같은 줄에 이어 쓴다.
  const runId = await openRun(wsId, "reddit", await weekOf(wsId));

  /** 루프를 어떻게 빠져나가든 기록을 남기고 결과에 번호를 단다. */
  const finish = async (r: TickResult): Promise<TickResult> => {
    await tagRun(runId, ["post_analysis", "idea_cards"]);
    const { rows: [n] } = await pool.query<{ posts: number; cards: number }>(
      `select (select count(*)::int from post_analysis where run_id = $1::bigint) as posts,
              (select count(*)::int from idea_cards    where run_id = $1::bigint) as cards`,
      [runId]
    );
    await closeRun(
      runId,
      r.stoppedBecause === "error" || r.stoppedBecause === "stalled" ? "failed" : "done",
      { posts: n.posts, cards: n.cards, steps: r.ran.map((x) => x.step), stoppedBecause: r.stoppedBecause },
      r.error
    );
    return r;
  };

  while (true) {
    const step = await nextStep();
    if (step === "idle") {
      return finish({ ran, stoppedBecause: "idle", elapsedMs: Date.now() - startedAt });
    }
    // 이 단계를 끝까지 돌릴 시간이 남았는지 먼저 본다. 없으면 다음 크론에 넘긴다.
    const elapsed = Date.now() - startedAt;
    if (elapsed + STEP_BUDGET_MS[step] > HARD_LIMIT_MS) {
      return finish({ ran, stoppedBecause: "deadline", elapsedMs: elapsed, nextStep: step });
    }
    try {
      const result = await runStep(step);
      ran.push({ step, result });

      // 핵심 안전장치: 처리한 게 0건이면 즉시 멈춘다.
      // "할 일 있다"는데 아무것도 처리하지 못했다면 조건과 처리 대상이 어긋난 것이다.
      // 다시 물어봐야 같은 답이 나오므로 반복해봐야 의미가 없고, LLM 비용만 샌다.
      if (progressOf(step, result) === 0) {
        return finish({
          ran, stoppedBecause: "stalled", elapsedMs: Date.now() - startedAt, nextStep: step,
          error: `${step}: 할 일이 있다고 판단했는데 0건을 처리했다. ` +
                 `판단 조건과 처리 대상이 어긋났을 가능성이 높다 — 코드를 확인할 것.`,
        });
      }
    } catch (err) {
      return finish({
        ran, stoppedBecause: "error", elapsedMs: Date.now() - startedAt,
        error: `${step}: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }
}
