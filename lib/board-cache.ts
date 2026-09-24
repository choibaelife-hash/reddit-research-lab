import { unstable_cache } from "next/cache";
import { getStats, getAreas } from "@/lib/board-data";

// 권한 확인은 호출하는 화면에서 매 요청 수행한다. 쿠키/사용자 정보는 캐시하지 않는다.
// runId는 전역 유일 실행번호이며, 실행이 없는 워크스페이스에는 반드시 "0"을 넘긴다.
export const getBoardSummary = unstable_cache(
  async (runId: string) => {
    const [stats, areas] = await Promise.all([getStats(runId), getAreas(runId)]);
    return { stats, areas };
  },
  ["board-summary-v1"],
  { tags: ["board-data"], revalidate: 60 }
);
