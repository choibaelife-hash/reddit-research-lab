import { cookies } from "next/headers";
import { pool } from "@/lib/db";
import { SESSION_COOKIE, WS_COOKIE, verifySession } from "@/lib/session.mjs";

// 화면이 "지금 누구의, 어느 워크스페이스의, 어느 주 데이터를 보고 있나"를 정하는 곳.
// 조회 함수(lib/board-data.ts)는 여기서 받은 실행번호로 거르기만 한다.

export type Workspace = { id: string; name: string; perspective: string | null };

export type Run = {
  id: string; week: string; kind: string; status: string;
  stats: any; started_at: string; finished_at: string | null; error: string | null;
};

export async function currentUserId(): Promise<string | null> {
  return verifySession((await cookies()).get(SESSION_COOKIE)?.value);
}

export async function myWorkspaces(): Promise<Workspace[]> {
  const uid = await currentUserId();
  if (!uid) return [];
  return (await pool.query<Workspace>(
    `select id, name, perspective from workspaces where user_id = $1 order by created_at`,
    [uid]
  )).rows;
}

/**
 * 지금 보고 있는 워크스페이스.
 * 쿠키에 담긴 것이 내 것이 아니면(남의 링크를 눌렀거나 계정을 바꿨거나) 무시하고 첫 번째를 준다.
 * 쿠키 값을 그대로 믿으면 남의 워크스페이스가 열린다.
 */
export async function currentWorkspace(): Promise<Workspace | null> {
  const list = await myWorkspaces();
  if (!list.length) return null;
  const want = (await cookies()).get(WS_COOKIE)?.value;
  return list.find((w) => w.id === want) ?? list[0];
}

/** 마이페이지의 실행 기록 표. */
export async function myRuns(kind?: string): Promise<Run[]> {
  const ws = await currentWorkspace();
  if (!ws) return [];
  return (await pool.query<Run>(
    `select id::text, week::text, kind, status, stats,
            started_at::text, finished_at::text, error
       from runs
      where workspace_id = $1 and ($2::text is null or kind = $2)
      order by week desc, kind
      limit 30`,
    [ws.id, kind ?? null]
  )).rows;
}

/** 그 주 실행 하나. week를 안 주면 가장 최근 주. */
export async function currentRun(kind: string, week?: string): Promise<Run | null> {
  const ws = await currentWorkspace();
  if (!ws) return null;
  const { rows } = await pool.query<Run>(
    `select id::text, week::text, kind, status, stats,
            started_at::text, finished_at::text, error
       from runs
      where workspace_id = $1 and kind = $2 and ($3::text is null or week = $3::date)
      order by week desc
      limit 1`,
    [ws.id, kind, week ?? null]
  );
  return rows[0] ?? null;
}
