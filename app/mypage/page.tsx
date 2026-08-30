import Link from "next/link";
import { pool } from "@/lib/db";
import { logout } from "@/app/login/actions";
import { switchWorkspace } from "@/app/board/switch";
import { currentUserId, myWorkspaces, currentWorkspace, myRuns } from "@/lib/workspace";
import { addWorkspace, renameWorkspace, savePerspective } from "./actions";

export const dynamic = "force-dynamic";

export default async function MyPage() {
  const uid = await currentUserId();
  const [spaces, here, runs] = await Promise.all([
    myWorkspaces(), currentWorkspace(), myRuns(),
  ]);
  const { rows: [me] } = await pool.query<{ email: string; created_at: string }>(
    `select email, created_at::date::text as created_at from users where id = $1`, [uid]
  );

  return (
    <div className="bwrap">
      <nav className="bnav">
        <div className="nvs">
          <Link href="/board" className="nv">← 보드로</Link>
          <span className="nv on">마이페이지</span>
        </div>
        <div className="navmeta">
          {me?.email}
          <form action={logout} style={{ display: "inline" }}>
            <button type="submit" className="logout">로그아웃</button>
          </form>
        </div>
      </nav>

      <section className="mysec">
        <h2>내 워크스페이스</h2>
        <table className="mytable">
          <thead><tr><th>이름</th><th>보는 관점</th><th></th></tr></thead>
          <tbody>
            {spaces.map((w) => (
              <tr key={w.id} className={w.id === here?.id ? "on" : ""}>
                <td>
                  <form action={renameWorkspace} className="inlineform">
                    <input type="hidden" name="id" value={w.id} />
                    <input name="name" defaultValue={w.name} />
                    <button type="submit">이름 저장</button>
                  </form>
                </td>
                <td>
                  <form action={savePerspective} className="inlineform">
                    <input type="hidden" name="id" value={w.id} />
                    <input
                      name="perspective"
                      defaultValue={w.perspective ?? ""}
                      placeholder="나는 서울에서 K-뷰티 제품·시술을 다룬다"
                    />
                    <button type="submit">저장</button>
                  </form>
                </td>
                <td>
                  {w.id === here?.id ? (
                    <b>보는 중</b>
                  ) : (
                    <form action={switchWorkspace} className="inlineform">
                      <input type="hidden" name="ws" value={w.id} />
                      <button type="submit">이걸로 보기</button>
                    </form>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <form action={addWorkspace} className="inlineform">
          <input name="name" placeholder="새 워크스페이스 이름" required />
          <button type="submit">추가</button>
        </form>
        <p className="mynote">
          '보는 관점'은 지금은 메모다. 앞으로 점수 계산에서 '한국 관련도'를 대신할 문장이다.
        </p>
      </section>

      <section className="mysec">
        <h2>실행 기록 — {here?.name}</h2>
        <table className="mytable">
          <thead>
            <tr><th>주</th><th>종류</th><th>상태</th><th>결과</th><th>끝난 시각</th><th></th></tr>
          </thead>
          <tbody>
            {runs.map((r) => (
              <tr key={r.id}>
                <td>{r.week}</td>
                <td>{r.kind === "reddit" ? "레딧" : "유튜브"}</td>
                <td className={`st ${r.status}`}>
                  {r.status === "done" ? "완료" : r.status === "failed" ? "실패" : "진행 중"}
                </td>
                <td>
                  {r.kind === "reddit"
                    ? `글 ${r.stats?.posts ?? 0}건 · 카드 ${r.stats?.cards ?? 0}장`
                    : `키워드 ${r.stats?.keywords ?? 0} · 영상 ${r.stats?.videos ?? 0}편 · 할당량 ${r.stats?.quotaPct ?? 0}%`}
                  {r.stats?.note && <div className="mynote">{r.stats.note}</div>}
                  {r.error && <div className="myerr">{r.error}</div>}
                </td>
                <td>{r.finished_at?.slice(0, 16) ?? "—"}</td>
                <td>
                  <Link href={r.kind === "video" ? `/board?tab=video&week=${r.week}` : `/board?week=${r.week}`}>
                    보기 →
                  </Link>
                </td>
              </tr>
            ))}
            {runs.length === 0 && (
              <tr><td colSpan={6}>아직 실행 기록이 없습니다.</td></tr>
            )}
          </tbody>
        </table>
      </section>

      <section className="mysec">
        <h2>계정</h2>
        <p>이메일 <b>{me?.email}</b> · 가입 {me?.created_at}</p>
        <p className="mynote">비밀번호 변경은 다음 단계에서 붙인다.</p>
      </section>
    </div>
  );
}
