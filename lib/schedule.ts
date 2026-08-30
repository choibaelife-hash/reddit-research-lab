import { pool } from "@/lib/db";

// 언제 무엇이 도는가 — 일정은 코드가 아니라 DB에 있다.
//
// 처음에는 Railway 크론에 요일·시각을 박았다. 고객 1명일 때만 되는 방식이다.
// 고객이 100명이면 크론 100개를 만들어야 하고, 고객이 스스로 시각을 바꿀 수도 없다.
//
// 지금 구조: Railway 크론은 **영원히 1개**다. 매시간 깨어나 이 파일에게
// "지금 돌 차례인 워크스페이스 있어?"를 묻고, 해당하는 것만 실행한다.
// lib/pipeline.ts가 "지금 할 단계"를 스스로 찾던 방식을 한 겹 위에 얹은 것이다.

export const DOW_KO = ["일", "월", "화", "수", "목", "금", "토"];

export type Schedule = { dow: number; hour: number; timezone: string };

/** "매주 월요일 오후 6시" — 마이페이지에 그대로 쓴다. */
export function scheduleLabel(s: Schedule): string {
  const ampm = s.hour < 12 ? "오전" : "오후";
  const h12 = s.hour % 12 === 0 ? 12 : s.hour % 12;
  return `매주 ${DOW_KO[s.dow]}요일 ${ampm} ${h12}시`;
}

/** 다음 실행 시각. 워크스페이스의 타임존 기준으로 계산한다. */
export function nextRunLabel(s: Schedule, now = new Date()): string {
  // 그 타임존에서 지금이 몇 요일 몇 시인지 알아낸다.
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: s.timezone, weekday: "short", hour: "numeric", hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(now).map((p) => [p.type, p.value]));
  const nowDow = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.weekday!);
  const nowHour = Number(parts.hour);

  let days = (s.dow - nowDow + 7) % 7;
  if (days === 0 && nowHour >= s.hour) days = 7;   // 오늘이지만 시각이 지났으면 다음 주

  const d = new Date(now.getTime() + days * 86_400_000);
  const md = new Intl.DateTimeFormat("ko-KR", {
    timeZone: s.timezone, month: "numeric", day: "numeric",
  }).format(d);
  const ampm = s.hour < 12 ? "오전" : "오후";
  const h12 = s.hour % 12 === 0 ? 12 : s.hour % 12;
  return `${md}(${DOW_KO[s.dow]}) ${ampm} ${h12}시`;
}

export type DueWorkspace = { id: string; name: string; week: string; timezone: string };

/**
 * 지금 돌 차례인 워크스페이스들.
 *
 * "그 타임존에서 오늘이 예정 요일이고, 예정 시각이 지났는가"를 본다.
 *
 * 시각을 `==`가 아니라 `>=`로 보는 이유: 주 1회짜리 시스템에서 그 한 번을 놓치면
 * 일주일이 통째로 날아간다. 크론을 예정 시각부터 몇 시간 더 돌려두면(예: 0 9-12 * * 1)
 * 첫 시도가 실패해도 같은 날 다시 잡힌다.
 *
 * 이미 이번 주에 돌았으면 건너뛴다 — 성공한 뒤의 재시도는 즉시 종료된다.
 *
 * 'running'이 3시간 넘게 남아 있으면 죽은 실행으로 보고 다시 잡는다.
 * 안 그러면 한 번 터진 워크스페이스가 영원히 막힌다.
 *
 * ponytail: limit로 한 번에 처리할 수를 막는다. 레딧은 IP 제한이 있어
 * 같은 시각에 몰린 워크스페이스를 동시에 못 돌린다(07-SAAS.md 1장).
 * 못 한 것은 다음 시간에 잡힌다 — 아직 그 시각이니까.
 */
export async function dueWorkspaces(limit = 3): Promise<DueWorkspace[]> {
  const { rows } = await pool.query<DueWorkspace>(
    `select w.id, w.name, w.timezone,
            (date_trunc('week', now() at time zone w.timezone))::date::text as week
       from workspaces w
      where extract(dow  from now() at time zone w.timezone)::int = w.schedule_dow
        and extract(hour from now() at time zone w.timezone)::int >= w.schedule_hour
        and not exists (
          select 1 from runs r
           where r.workspace_id = w.id
             and r.kind = 'reddit'
             and r.week = (date_trunc('week', now() at time zone w.timezone))::date
             and (r.status = 'done'
                  or (r.status = 'running' and r.started_at > now() - interval '3 hours'))
        )
      order by w.created_at
      limit $1`,
    [limit]
  );
  return rows;
}

/** 그 워크스페이스의 이번 주 월요일. 타임존 기준이라 서버 UTC와 어긋나지 않는다. */
export async function weekOf(workspaceId: string): Promise<string> {
  const { rows } = await pool.query<{ week: string }>(
    `select (date_trunc('week', now() at time zone timezone))::date::text as week
       from workspaces where id = $1`,
    [workspaceId]
  );
  if (!rows[0]) throw new Error(`워크스페이스를 찾을 수 없다: ${workspaceId}`);
  return rows[0].week;
}
