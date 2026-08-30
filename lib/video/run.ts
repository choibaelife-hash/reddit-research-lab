import { pickKeywords, saveKeywords, mondayOf } from "./keywords";
import { searchKeyword, pickTop, saveCandidates } from "./youtube";
import { getQuotes, refineSearchQuery } from "./query";
import { openRun, closeRun, tagRun, defaultWorkspaceId } from "@/lib/runs";

// 주 1회 실행. 레딧 파이프라인(lib/pipeline.ts)과 완전히 분리돼 있다.
// 여기가 터져도 레딧 수집·분류·카드는 그대로 돈다.

export async function runVideo(opts: { week?: string; limit?: number } = {}) {
  const week = opts.week ?? mondayOf();
  const limit = opts.limit ?? 3;

  const runId = await openRun(await defaultWorkspaceId(), "video", week);

  const picks = await pickKeywords(week, limit);
  if (!picks.length) {
    await closeRun(runId, "done", { keywords: 0 });
    return { week, keywords: 0, note: "이번 주 키워드 없음 (레딧 데이터 부족)" };
  }

  // 검색어 오염 방지(B안, 03-VIDEO.md 11장 #7): entity 키워드는 레딧 맥락으로 검색어를 구체화한다.
  // topic 키워드는 이미 문장형이라 그대로 둔다.
  for (const p of picks) {
    if (p.reason.source === "entity") {
      const quotes = await getQuotes(p.keyword);
      const { query } = await refineSearchQuery(p.keyword, quotes);
      if (query && query.toLowerCase() !== p.keyword.toLowerCase()) p.reason.search_query = query;
    }
  }

  const ids = await saveKeywords(week, picks);

  let units = 0;
  const result: { keyword: string; searchTerm: string; found: number; picked: number; topOutlier: number | null }[] = [];

  for (let i = 0; i < picks.length; i++) {
    const term = picks[i].reason.search_query ?? picks[i].keyword;
    const { candidates, unitsUsed } = await searchKeyword(term);
    units += unitsUsed;

    const top = pickTop(candidates, 5);
    await saveCandidates(week, ids[i], candidates, top);

    result.push({
      keyword: picks[i].keyword,
      searchTerm: term,
      found: candidates.length,
      picked: top.length,
      topOutlier: top[0]?.outlier ?? null,
    });
  }

  // 할당량은 돈 주고 못 산다(구글 심사만 가능). 얼마 썼는지 항상 남긴다.
  await tagRun(runId, ["video_keywords"]);
  await closeRun(runId, "done", {
    keywords: picks.length,
    videos: result.reduce((s, r) => s + r.found, 0),
    picked: result.reduce((s, r) => s + r.picked, 0),
    quotaUnits: units,
    quotaPct: Math.round((units / 10000) * 100),
  });

  return { week, keywords: picks.length, unitsUsed: units, quotaPct: Math.round((units / 10000) * 100), result };
}
