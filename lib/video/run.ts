import { pickKeywords, saveKeywords, mondayOf } from "./keywords";
import { searchKeyword, pickTop, saveCandidates } from "./youtube";

// 주 1회 실행. 레딧 파이프라인(lib/pipeline.ts)과 완전히 분리돼 있다.
// 여기가 터져도 레딧 수집·분류·카드는 그대로 돈다.

export async function runVideo(opts: { week?: string; limit?: number } = {}) {
  const week = opts.week ?? mondayOf();
  const limit = opts.limit ?? 5;

  const picks = await pickKeywords(week, limit);
  if (!picks.length) return { week, keywords: 0, note: "이번 주 키워드 없음 (레딧 데이터 부족)" };

  const ids = await saveKeywords(week, picks);

  let units = 0;
  const result: { keyword: string; found: number; picked: number; topOutlier: number | null }[] = [];

  for (let i = 0; i < picks.length; i++) {
    const { candidates, unitsUsed } = await searchKeyword(picks[i].keyword);
    units += unitsUsed;

    const top = pickTop(candidates, 5);
    await saveCandidates(week, ids[i], candidates, top);

    result.push({
      keyword: picks[i].keyword,
      found: candidates.length,
      picked: top.length,
      topOutlier: top[0]?.outlier ?? null,
    });
  }

  // 할당량은 돈 주고 못 산다(구글 심사만 가능). 얼마 썼는지 항상 남긴다.
  return { week, keywords: picks.length, unitsUsed: units, quotaPct: Math.round((units / 10000) * 100), result };
}
