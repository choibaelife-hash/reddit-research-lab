import { pool } from "@/lib/db";

// 주간 실행 한 줄을 열고 닫는다. 마이페이지의 '실행 기록' 표가 이 데이터다.

/**
 * 크론에는 로그인 세션이 없다. 지금은 워크스페이스가 하나뿐이므로 첫 번째를 쓴다.
 *
 * ponytail: 워크스페이스가 둘 이상이 되면 크론이 워크스페이스마다 한 바퀴 돌아야 한다.
 * 그때 이 함수를 지우고 pipeline.tick(workspaceId)로 바꾼다.
 */
export async function defaultWorkspaceId(): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `select id from workspaces order by created_at limit 1`
  );
  if (!rows[0]) throw new Error("워크스페이스가 없다 — npm run seed 를 먼저 돌릴 것");
  return rows[0].id;
}

/**
 * 이번 주 실행 줄을 확보한다. 크론은 한 주에 여러 번 깨어나므로
 * 이미 있으면 그 줄을 다시 쓴다(unique (workspace_id, week, kind)).
 */
export async function openRun(
  workspaceId: string,
  kind: "reddit" | "video",
  week: string
): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `insert into runs (workspace_id, week, kind, status)
     values ($1, $2::date, $3, 'running')
     on conflict (workspace_id, week, kind)
       do update set status = 'running', error = null
     returning id::text`,
    [workspaceId, week, kind]
  );
  return rows[0].id;
}

/**
 * stats는 덮어쓰지 않고 합친다(`||`). 크론이 여러 번 깨어나며
 * 조금씩 진행하므로, 마지막 호출이 앞선 기록을 지워버리면 안 된다.
 */
export async function closeRun(
  runId: string,
  status: "done" | "failed",
  stats: Record<string, unknown>,
  error?: string
): Promise<void> {
  await pool.query(
    `update runs
        set status = $2,
            stats = stats || $3::jsonb,
            error = $4,
            finished_at = now()
      where id = $1::bigint`,
    [runId, status, JSON.stringify(stats ?? {}), error ?? null]
  );
}

/**
 * 아직 실행번호가 없는 결과에 이번 실행번호를 단다.
 *
 * 분석 함수(classify·cards·rescore…)가 여덟 군데에서 결과를 쓴다. 여덟 군데를 다 고치는 대신
 * 실행이 끝날 때 "번호 없는 것"에 한 번에 붙인다. 분석 코드는 손대지 않아도 된다.
 *
 * ponytail: 워크스페이스가 하나일 때만 맞다. 둘 이상이 동시에 돌면 남의 결과에
 * 번호가 붙는다. 그때는 각 분석 함수가 직접 run_id를 쓰도록 바꾼다.
 *
 * 테이블 이름은 우리 코드 안의 상수만 넘긴다(사용자 입력이 아니다).
 */
const TAGGABLE = ["post_analysis", "idea_cards", "video_keywords"];

export async function tagRun(runId: string, tables: string[]): Promise<void> {
  for (const t of tables) {
    if (!TAGGABLE.includes(t)) throw new Error(`태그할 수 없는 테이블: ${t}`);
    await pool.query(`update ${t} set run_id = $1::bigint where run_id is null`, [runId]);
  }
}
