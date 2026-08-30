import Link from "next/link";
import { logout } from "@/app/login/actions";
import { switchWorkspace } from "@/app/board/switch";
import {
  me, myWorkspaces, currentWorkspace, runsByWorkspace, lastRunAt, weekLabel, PLANS,
  COLLECT_LABEL, nextCollectLabel, lastCollectLabel, collectLooksStale,
  type Run,
} from "@/lib/workspace";
import { addWorkspace, renameWorkspace, savePerspective } from "./actions";

export const dynamic = "force-dynamic";

// 마이페이지는 '설정 화면'이 아니라 '내 자료 허브'다.
// 워크스페이스(상위) 안에 주차(하위)가 들어 있는 계층을 그대로 보여준다.
// 실행 기록을 하나의 긴 표로 두면 워크스페이스가 여러 개일 때 무엇이 누구 것인지 사라진다.

/** 한 워크스페이스의 실행들을 주차로 묶는다. 같은 주에 레딧 1줄 + 유튜브 1줄이 들어온다. */
function byWeek(runs: Run[]): [string, Run[]][] {
  const m = new Map<string, Run[]>();
  for (const r of runs) m.set(r.week, [...(m.get(r.week) ?? []), r]);
  return [...m.entries()];
}

export default async function MyPage() {
  const [who, spaces, here, runsMap, last] = await Promise.all([
    me(), myWorkspaces(), currentWorkspace(), runsByWorkspace(), lastRunAt(),
  ]);
  const plan = PLANS[who?.plan ?? "pro"];
  const full = spaces.length >= plan.workspaces;

  return (
    <div className="bwrap">
      <nav className="bnav">
        <div className="nvs">
          <Link href="/board" className="nv">← 보드로</Link>
          <span className="nv on">마이페이지</span>
        </div>
        <div className="navmeta">
          <span className="crumb"><b className="crumbws">{who?.email}</b></span>
          <form action={logout}>
            <button type="submit" className="nv">로그아웃</button>
          </form>
        </div>
      </nav>

      <section className="mysec">
        <h2>구독</h2>
        <p>
          <b>{plan.label} 요금제</b> · 워크스페이스 {spaces.length} / {plan.workspaces} 사용
        </p>

        <div className="sched">
          <div className="schedrow">
            <span className="schedk">수집 주기</span>
            <b>{COLLECT_LABEL}</b>
            <span className="mynote">미국(하와이 제외)에서 일요일이 끝난 뒤에 모읍니다</span>
          </div>
          <div className="schedrow">
            <span className="schedk">다음 수집</span>
            <b>{nextCollectLabel()}</b>
          </div>
          <div className="schedrow">
            <span className="schedk">마지막 수집</span>
            {lastCollectLabel(last) ?? "없음"}
          </div>
        </div>

        {/* 화면에 일정만 적어두고 실제로는 안 도는 상태를 사용자가 모르면 안 된다.
            마지막 수집이 8일을 넘겼다면 크론이 없거나 실패하고 있는 것이다. */}
        {collectLooksStale(last) && (
          <p className="warn">
            마지막 수집이 일주일을 넘었습니다. 자동 수집이 아직 등록되지 않았거나 실패하고 있을 수 있습니다.
          </p>
        )}
      </section>

      <section className="mysec">
        <h2>워크스페이스</h2>

        {spaces.map((w) => {
          const weeks = byWeek(runsMap.get(w.id) ?? []);
          return (
            <div key={w.id} className={`wscard${w.id === here?.id ? " on" : ""}`}>
              <div className="wshead">
                <form action={renameWorkspace} className="inlineform">
                  <input type="hidden" name="id" value={w.id} />
                  <input name="name" defaultValue={w.name} />
                  <button type="submit">이름 저장</button>
                </form>
                {w.id === here?.id ? (
                  <span className="wknow">보는 중</span>
                ) : (
                  <form action={switchWorkspace} className="inlineform">
                    <input type="hidden" name="ws" value={w.id} />
                    <button type="submit">이걸로 보기</button>
                  </form>
                )}
              </div>

              <form action={savePerspective} className="inlineform">
                <input type="hidden" name="id" value={w.id} />
                <input name="perspective" defaultValue={w.perspective ?? ""}
                       placeholder="나는 서울에서 K-뷰티 제품·시술을 다룬다" />
                <button type="submit">관점 저장</button>
              </form>

              <div className="wklist">
                {weeks.length === 0 && <p className="mynote">아직 수집된 주가 없습니다.</p>}
                {weeks.map(([week, rs]) => {
                  const reddit = rs.find((r) => r.kind === "reddit");
                  const video = rs.find((r) => r.kind === "video");
                  const failed = rs.find((r) => r.status === "failed");
                  return (
                    <div key={week} className="wkrow">
                      <span className="wkname">{weekLabel(week)}</span>
                      <span className="mdate">{week}</span>
                      {reddit && <span>글 {reddit.stats?.posts ?? 0}건 · 카드 {reddit.stats?.cards ?? 0}장</span>}
                      {video && <span>키워드 {video.stats?.keywords ?? 0} · 영상 {video.stats?.videos ?? 0}편</span>}
                      {failed && <span className="myerr">{failed.error ?? "실패"}</span>}
                      {rs[0]?.stats?.note && <span className="mynote">{rs[0].stats.note}</span>}
                      <Link href={`/board?week=${week}`} className="wkgo">보기 →</Link>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}

        {full ? (
          <p className="mynote">
            {plan.label} 요금제는 워크스페이스 {plan.workspaces}개까지입니다.
          </p>
        ) : (
          <form action={addWorkspace} className="inlineform">
            <input name="name" placeholder="새 워크스페이스 이름" required />
            <button type="submit">추가</button>
          </form>
        )}
        <p className="mynote">
          &apos;관점&apos;은 지금은 메모입니다. 앞으로 점수 계산에서 &apos;한국 관련도&apos;를 대신할 문장입니다.
        </p>
      </section>

      <section className="mysec">
        <h2>계정</h2>
        <p>이메일 <b>{who?.email}</b> · 가입 {who?.created_at}</p>
        <p className="mynote">비밀번호 변경 화면은 아직 없습니다. 지금은 npm run seed 로 바꿉니다.</p>
      </section>
    </div>
  );
}
