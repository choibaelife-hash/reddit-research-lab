/**
 * 지금 실행할 워크스페이스마다 Reddit/RSS 파이프라인만 돈다.
 *
 * YouTube 기능은 별도 저장소로 분리했으며 운영 크론에서는 실행하지 않는다.
 * 의존성을 인자로 받는 이유는 외부 API를 부르지 않고 순서를 시험하기 위해서다.
 */
export async function runDue({ call, reddit, log }) {
  const { due: list = [] } = await call("/api/cron/due");
  if (!list.length) {
    log("지금 돌 차례인 워크스페이스 없음");
    return { total: 0, failed: 0 };
  }

  log(`대상 ${list.length}개:`, list.map((w) => w.name).join(", "));

  let failed = 0;
  for (const workspace of list) {
    try {
      log(`── ${workspace.name} (${workspace.week}) 시작`);
      await reddit(workspace.id);
      log(`── ${workspace.name} 완료`);
    } catch (error) {
      failed += 1;
      log(
        `── ${workspace.name} 실패:`,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  return { total: list.length, failed };
}
