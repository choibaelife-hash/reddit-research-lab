import { unstable_cache } from "next/cache";
import {
  BOARD_PAGE_SIZE, getStats, getAreas, getCards, getCardSummaries,
  getAreaPosts, getAreaTypes, getKeywords, getEntityKinds, getTopEntities,
  getDemands, getClinicGap, getRssFeeds, getRssItems, getStockPage, getStockCounts,
} from "@/lib/board-data";

export const cardCacheTag = (runId: string) => `board-cards:${runId}`;
export const countCacheTag = (runId: string) => `board-counts:${runId}`;
const collection = { tags: ["board-data"], revalidate: 60 };

// 권한 확인은 호출하는 화면에서 매 요청 수행한다. 쿠키/사용자 정보는 캐시하지 않는다.
// runId는 전역 유일 실행번호이며, 실행이 없는 워크스페이스에는 반드시 "0"을 넘긴다.
const cachedAreas = unstable_cache(getAreas, ["board-areas-v2"], collection);
export async function getBoardSummary(runId: string) {
  const [stats, areas] = await Promise.all([
    unstable_cache(() => getStats(runId), ["board-stats-v2", runId],
      { ...collection, tags: ["board-data", countCacheTag(runId)] })(),
    cachedAreas(runId),
  ]);
  return { stats, areas };
}

export function getBoardCards(runId: string, mode: "ideas" | "draft") {
  return unstable_cache(
    () => getCards(runId, { savedOnly: mode === "draft", includeComments: mode === "ideas" }),
    ["board-cards-v2", runId, mode],
    { ...collection, tags: ["board-data", cardCacheTag(runId)] }
  )();
}

export function getBoardCardSummaries(runId: string) {
  return unstable_cache(() => getCardSummaries(runId), ["board-picks-v2", runId],
    { ...collection, tags: ["board-data", cardCacheTag(runId)] })();
}

export const getBoardAreaPosts = unstable_cache(getAreaPosts, ["board-area-posts-v2"], collection);
export const getBoardAreaTypes = unstable_cache(getAreaTypes, ["board-area-types-v2"], collection);
export const getBoardKeywords = unstable_cache(getKeywords, ["board-keywords-v2"], collection);
export const getBoardEntityKinds = unstable_cache(getEntityKinds, ["board-entity-kinds-v2"], collection);
export const getBoardTopEntities = unstable_cache(getTopEntities, ["board-top-entities-v2"], collection);
export const getBoardDemands = unstable_cache(getDemands, ["board-demands-v2"], collection);
export const getBoardClinicGap = unstable_cache(getClinicGap, ["board-clinic-gap-v2"], collection);
export const getBoardRssFeeds = unstable_cache(getRssFeeds, ["board-rss-feeds-v2"], collection);
export const getBoardRssItems = unstable_cache(
  (page: number) => getRssItems(BOARD_PAGE_SIZE, (page - 1) * BOARD_PAGE_SIZE),
  ["board-rss-items-v2"], collection
);
export const getBoardStockPage = unstable_cache(getStockPage, ["board-stock-page-v2"], collection);
export const getBoardStockCounts = unstable_cache(getStockCounts, ["board-stock-counts-v2"], collection);
