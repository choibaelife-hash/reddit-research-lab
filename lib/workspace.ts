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

// 요금제가 정하는 건 지금은 하나뿐 — 워크스페이스를 몇 개까지 만들 수 있나.
// 결제 연동이 없으므로 등급은 사람이 DB에서 바꾼다(update users set plan = 'team').
// free가 없는 이유: 회원가입 페이지가 없어서 계정이 있다는 것 자체가 유료 고객이라는 뜻이다.
export const PLANS = {
  pro:  { label: "Pro",  workspaces: 3 },
  team: { label: "Team", workspaces: 10 },
} as const;

export type Me = { email: string; plan: keyof typeof PLANS; created_at: string };

/** 로그인한 사람. 없으면 null. */
export async function me(): Promise<Me | null> {
  const uid = await currentUserId();
  if (!uid) return null;
  const { rows } = await pool.query<Me>(
    `select email, plan, created_at::date::text as created_at from users where id = $1`,
    [uid]
  );
  return rows[0] ?? null;
}

/** 사용자는 날짜보다 '몇째 주'로 기억한다. "2026-08-24" → "8월 4주" */
export function weekLabel(week: string): string {
  const [, m, d] = week.split("-").map(Number);
  return `${m}월 ${Math.ceil(d / 7)}주`;
}

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

/**
 * 내 모든 워크스페이스의 실행 기록. 마이페이지가 워크스페이스별로 묶어 보여준다.
 *
 * myRuns()는 '지금 보고 있는' 워크스페이스 것만 준다. 마이페이지에서는
 * 안 보고 있는 워크스페이스의 주차도 함께 보여야 계층(워크스페이스 > 주차)이 드러난다.
 */
export async function runsByWorkspace(): Promise<Map<string, Run[]>> {
  const uid = await currentUserId();
  if (!uid) return new Map();
  const { rows } = await pool.query<Run & { workspace_id: string }>(
    `select r.id::text, r.week::text, r.kind, r.status, r.stats,
            r.started_at::text, r.finished_at::text, r.error,
            r.workspace_id::text
       from runs r
       join workspaces w on w.id = r.workspace_id
      where w.user_id = $1
      order by r.week desc, r.kind`,
    [uid]
  );
  const out = new Map<string, Run[]>();
  for (const r of rows) {
    const list = out.get(r.workspace_id) ?? [];
    list.push(r);
    out.set(r.workspace_id, list);
  }
  return out;
}

/**
 * 자동 수집이 실제로 등록돼 있는지.
 *
 * 지금은 Railway에 크론이 등록돼 있지 않다(scripts/cron.mjs는 있지만 부르는 스케줄이 없다).
 * 화면에 "매주 월요일 6시"라고 써두면 거짓말이 되므로, 마지막 실행 시각만 사실대로 보여주고
 * 자동 실행 여부는 아직 모른다고 말한다. 크론을 등록하면 여기를 고친다.
 */
export async function lastRunAt(): Promise<string | null> {
  const uid = await currentUserId();
  if (!uid) return null;
  const { rows } = await pool.query<{ at: string | null }>(
    `select max(r.finished_at)::text as at
       from runs r join workspaces w on w.id = r.workspace_id
      where w.user_id = $1`,
    [uid]
  );
  return rows[0]?.at ?? null;
}

// ── 자동 수집 일정 ────────────────────────────────────────
//
// 크론은 Railway에 UTC로 등록한다. 여기 값과 docs/06-DEPLOY-RAILWAY.md 3장이 어긋나면
// 화면이 거짓말을 하게 되므로, 일정을 바꿀 때 두 곳을 함께 고친다.
//
//   레딧    0 9 * * 1   (UTC)  = 한국 월요일 18:00
//   영상 1  0 11 * * 1         = 월요일 20:00
//   영상 2  0 12 * * 1         = 월요일 21:00
//
// 월요일 저녁인 이유: 레딧 top?t=week는 달력 주가 아니라 '지금부터 거슬러 7일'이라
// 매주 같은 시각에 불러야 창이 어긋나지 않고, 주말 글이 업보트를 다 받은 뒤여야
// top 순위(=화제성 점수)가 제대로 나온다.
const COLLECT_UTC_HOUR = 9;   // 월요일 09:00 UTC
export const COLLECT_LABEL = "매주 월요일 오후 6시";

const DAY_KO = ["일", "월", "화", "수", "목", "금", "토"];

/** UTC 시각을 한국 시간 표기로. "8월 31일(월) 오후 6시" */
function kstLabel(d: Date): string {
  const k = new Date(d.getTime() + 9 * 3_600_000);
  const h = k.getUTCHours();
  const ampm = h < 12 ? "오전" : "오후";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  const min = k.getUTCMinutes();
  return `${k.getUTCMonth() + 1}월 ${k.getUTCDate()}일(${DAY_KO[k.getUTCDay()]}) ` +
         `${ampm} ${h12}시${min ? ` ${min}분` : ""}`;
}

/** 다음 자동 수집 시각. 화면에 "다음 수집: …"으로 보여준다. */
export function nextCollectLabel(now = new Date()): string {
  const d = new Date(Date.UTC(
    now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), COLLECT_UTC_HOUR, 0, 0
  ));
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));  // 이번 주 월요일
  while (d <= now) d.setUTCDate(d.getUTCDate() + 7);
  return kstLabel(d);
}

/** 마지막 수집 시각을 한국 시간 표기로. 없으면 null. */
export function lastCollectLabel(iso: string | null): string | null {
  return iso ? kstLabel(new Date(iso)) : null;
}

/**
 * 자동 수집이 실제로 도는지 의심할 근거.
 *
 * 크론이 등록돼 있으면 마지막 수집이 8일을 넘길 수 없다(주 1회 + 하루 여유).
 * 넘겼다면 Railway에 크론이 없거나 실패하고 있는 것이다.
 * 화면에 일정만 적어두고 실제로는 안 도는 상태를 사용자가 모르면 안 된다.
 */
export function collectLooksStale(iso: string | null): boolean {
  if (!iso) return true;
  return Date.now() - new Date(iso).getTime() > 8 * 24 * 3_600_000;
}
