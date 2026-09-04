import Link from "next/link";
import { BoardCard } from "@/components/board/BoardCard";
import { logout } from "@/app/login/actions";
import { VideoTab } from "@/components/video/VideoTab";
import { currentRun, myWorkspaces, currentWorkspace, myRuns, me, weekLabel, PLANS } from "@/lib/workspace";
import { switchWorkspace } from "./switch";
import {
  SUB_ORDER, getCards, getStock, getStockDropped, getAreas, getAreaPosts, getAreaTypes,
  getKeywords, getEntityKinds, getTopEntities, getDemands, getClinicGap,
  getRssFeeds, getRssItems, getStats,
} from "@/lib/board-data";

export const dynamic = "force-dynamic";

const TABS = [
  { k: "main", label: "한눈에" },
  { k: "ideas", label: "쓸 소재" },
  { k: "stock", label: "재고" },
  { k: "rss", label: "RSS" },
  { k: "mine", label: "나의 요청" },
  { k: "draft", label: "글감" },
  { k: "video", label: "유튜브" },
] as const;

type SP = { tab?: string; area?: string; sub?: string; week?: string; v?: string };

export default async function BoardPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const tab = TABS.some((t) => t.k === sp.tab) ? sp.tab! : "main";

  // 화면 전체가 이 실행 하나를 본다. week가 없으면 가장 최근 주.
  const run = await currentRun("reddit", sp.week);
  // 실행이 없으면 존재할 수 없는 번호를 넘긴다.
  // null을 넘기면 조회 함수의 `$1 is null or ...` 조건이 참이 되어 필터가 통째로 꺼지고,
  // 실행 기록이 하나도 없는 새 워크스페이스에 남의 워크스페이스 데이터가 보인다.
  // bigserial은 1부터 시작하므로 0은 어떤 행과도 안 맞는다.
  const runId = run?.id ?? "0";

  const [spaces, here, runs, who] = await Promise.all([
    myWorkspaces(), currentWorkspace(), myRuns("reddit"), me(),
  ]);
  const plan = PLANS[who?.plan ?? "pro"];

  const [stats, cards, areas] = await Promise.all([
    getStats(runId), getCards(runId), getAreas(runId),
  ]);
  const saved = cards.filter((c) => c.status === "saved");
  const href = (next: Partial<SP>) => {
    const q = new URLSearchParams();
    const merged = { tab, area: sp.area, sub: sp.sub, week: sp.week, ...next };
    for (const [k, v] of Object.entries(merged)) if (v) q.set(k, String(v));
    return `/board?${q.toString()}`;
  };

  const counts: Record<string, number> = {
    ideas: cards.length, draft: saved.length,
  };

  return (
    <div className="bwrap">
      <nav className="bnav">
        {/* 우측 상단 계정 영역.
            드롭다운은 <details>로 만든다 — 자바스크립트 없이 되고 서버 컴포넌트로 남는다.
            바깥을 눌러도 안 닫히는 건 <details>의 한계다. 그걸 고치자고
            클라이언트 컴포넌트를 하나 더 만들 만한 일은 아니다. */}
        <div className="navtop">
          <details className="menu">
            <summary>{here?.name ?? "워크스페이스"}</summary>
            <div className="menupanel">
              {spaces.map((w) =>
                w.id === here?.id ? (
                  <span key={w.id} className="mrow on">✓ {w.name}</span>
                ) : (
                  <form key={w.id} action={switchWorkspace}>
                    <input type="hidden" name="ws" value={w.id} />
                    <button type="submit" className="mrow">{w.name}</button>
                  </form>
                )
              )}
              <div className="mdiv" />
              <Link href="/mypage" className="mrow">워크스페이스 관리</Link>
            </div>
          </details>

          <details className="menu">
            <summary>{who?.email.split("@")[0] ?? "계정"}</summary>
            <div className="menupanel">
              <div className="mhead">
                {who?.email}
                <div className="mplan">
                  {plan.label} 요금제 · 워크스페이스 {spaces.length} / {plan.workspaces}
                </div>
              </div>
              <div className="mdiv" />
              <Link href="/mypage" className="mrow">마이페이지</Link>
              <form action={logout}>
                <button type="submit" className="mrow">로그아웃</button>
              </form>
            </div>
          </details>
        </div>

        <div className="nvs">
          {TABS.map((t) => (
            <Link key={t.k} href={href({ tab: t.k, area: undefined, sub: undefined })}
                  className={`nv${tab === t.k ? " on" : ""}`} scroll={false}>
              {t.label}
              {counts[t.k] !== undefined && <span className="n">{counts[t.k]}</span>}
            </Link>
          ))}
        </div>
        <div className="navchart">
          {areas.map((a) => (
            <span key={a.area} className="nseg" style={{ flex: a.n }} title={`${a.area} ${a.n}건`} />
          ))}
        </div>
        {/* 계층을 한 줄로 드러낸다: 워크스페이스(상위) › 주차(하위).
            이 둘이 탭·요약과 같은 줄에 뭉쳐 있으면 무엇이 무엇의 아래인지 안 보인다. */}
        <div className="navmeta">
          <span className="crumb">
            <b className="crumbws">{here?.name ?? "—"}</b>
            <span className="crumbsep">›</span>
            <details className="menu wkmenu">
              <summary>{run ? weekLabel(run.week) : "기록 없음"}</summary>
              <div className="menupanel">
                {runs.length === 0 && <span className="mrow dim">아직 수집된 주가 없습니다.</span>}
                {runs.map((r) => (
                  <Link key={r.id} href={href({ week: r.week })} scroll={false}
                        className={`mrow${r.week === run?.week ? " on" : ""}`}>
                    {weekLabel(r.week)} <span className="mdate">{r.week}</span>
                  </Link>
                ))}
              </div>
            </details>
          </span>
          <span className="navsum">
            레딧 {stats.posts}건 · 키워드 {stats.entities} · 댓글 {stats.comments}개 글 ·
            평균 가치 {stats.avg_worth} · 확정 <b>{saved.length}</b>건
          </span>
        </div>
      </nav>

      {tab === "main" && <MainTab areas={areas} area={sp.area} href={href} cards={cards} runId={runId} />}
      {tab === "ideas" && <IdeasTab cards={cards} />}
      {tab === "stock" && <StockTab sub={sp.sub} href={href} runId={runId} />}
      {tab === "rss" && <RssTab />}
      {tab === "mine" && <MineTab areas={areas} />}
      {tab === "draft" && <DraftTab cards={saved} />}
      {tab === "video" && <VideoTab week={sp.week} video={sp.v} />}
    </div>
  );
}

/* ───────────────────────── 한눈에 ───────────────────────── */

async function MainTab({ areas, area, href, cards, runId }: any) {
  const [keywords, entKinds, topEnts] = await Promise.all([
    getKeywords(), getEntityKinds(), getTopEntities(),
  ]);
  const selected = area && areas.some((a: any) => a.area === area) ? area : areas[0]?.area;
  const [areaPosts, areaTypes] = await Promise.all([
    getAreaPosts(selected, runId), getAreaTypes(selected, runId),
  ]);

  const kmax = Math.max(...keywords.map((k: any) => k.total), 1);
  const kstep = (n: number) => Math.max(1, Math.min(5, 1 + Math.round((n - 1) / Math.max(1, kmax - 1) * 4)));
  const holes = keywords.filter((k: any) => k.asked > 0 && k.rev === 0 && k.reco === 0);
  const amax = Math.max(...areas.map((a: any) => a.n), 1);
  const ek: Record<string, number> = Object.fromEntries(entKinds.map((e: any) => [e.kind, e.n]));

  const byWorth = [...cards].sort((a: any, b: any) => b.worth - a.worth);

  return (
    <>
      <section className="block">
        <p className="eyebrow">키워드</p>
        <h2>이번 주에 나온 키워드</h2>
        <div className="insight">
          글과 댓글에서 실제로 뽑힌 이름입니다. <b>언급이 많을수록 진한 칸</b>이에요.
          <b> 붉은 테두리</b>는 묻는 사람은 있는데 후기·추천이 하나도 없는 키워드 —
          이번 주 {holes.length}개고, 그 자리가 먼저 쓸 자리입니다.
        </div>
        <div className="kgrid">
          {keywords.map((k: any) => {
            const hole = k.asked > 0 && k.rev === 0 && k.reco === 0;
            return (
              <div key={k.name} className={`ktile k${kstep(k.total)}${hole ? " khole" : ""}`}>
                <span className="kko">{k.name_ko || k.name}</span>
                <span className="ken">{k.name}</span>
                <span className="kn">{k.total}</span>
                {hole && <span className="kflag">답 없음</span>}
              </div>
            );
          })}
        </div>
      </section>

      <section className="block">
        <p className="eyebrow">분류</p>
        <h2>{stats0(cards)}건이 어떻게 나뉘었나</h2>
        <div className="insight">
          막대 높이는 <b>건수</b>, 아래 게이지는 <b>평균 가치</b>입니다. 막대를 누르면 아래에 펼쳐집니다.
        </div>
        <div className="cols">
          {areas.map((a: any) => (
            <Link key={a.area} href={href({ area: a.area })} scroll={false}
                  className={`col${a.area === selected ? " on" : ""}`}>
              <span className="cv">{a.n}<span className="cu">건</span></span>
              <span className="cbar" style={{ height: Math.max(8, Math.round(a.n / amax * 130)) }} />
              <span className="cl">{a.area}</span>
              <span className="cg"><span style={{ width: `${a.avg_worth}%` }} /></span>
              <span className="ca">가치 {a.avg_worth}</span>
            </Link>
          ))}
        </div>
        <div className="apanel">
          <div className="apgrid">
            <div>
              <h4>{selected} — 사람들이 뭘 하고 있나</h4>
              <div className="tablewrap"><table className="tsmall">
                <thead><tr><th>글 유형</th><th className="num">건수</th></tr></thead>
                <tbody>{areaTypes.map((t: any) => (
                  <tr key={t.type}><th scope="row">{t.type}</th><td className="num">{t.n}</td></tr>
                ))}</tbody>
              </table></div>
            </div>
            <div>
              <h4>가치 순위</h4>
              <div className="tablewrap"><table className="tsmall">
                <thead><tr><th className="num">가치</th><th>글</th><th>유형</th></tr></thead>
                <tbody>{areaPosts.map((p: any) => (
                  <tr key={p.url}>
                    <td className="num pw">{p.worth}</td>
                    <th scope="row"><a href={p.url} target="_blank" rel="noopener noreferrer">{p.title.slice(0, 56)}</a>
                      <div className="ptopic">{p.topic}</div></th>
                    <td className="small muted">{p.type}</td>
                  </tr>
                ))}</tbody>
              </table></div>
            </div>
          </div>
        </div>
      </section>

      <section className="block">
        <p className="eyebrow">이번 주 픽</p>
        <h2>이건 꼭 쓰세요</h2>
        <div className="insight">
          서브레딧별 한 줄, 왼쪽이 가치 높은 순. <b>칸 색이 진할수록 가치가 높습니다.</b>
          누르면 <b>쓸 소재</b> 탭에서 그 카드로 이동합니다.
        </div>
        <div className="bingo">
          {SUB_ORDER.map((sub) => {
            const row = byWorth.filter((c: any) => c.sub === sub);
            if (!row.length) return null;
            const lo = Math.min(...byWorth.map((c: any) => c.worth));
            const hi = Math.max(...byWorth.map((c: any) => c.worth));
            const step = (w: number) => hi === lo ? 3 : Math.max(1, Math.min(5, 1 + Math.round((w - lo) / (hi - lo) * 4)));
            return (
              <div className="brow" key={sub}>
                <div className="blabel">r/{sub}</div>
                <div className="bcells">
                  {row.map((c: any) => (
                    <Link key={c.id} href={`/board?tab=ideas#card-${c.id}`}
                          className={`bcell s${step(c.worth)}${c.status === "saved" ? " done" : ""}`}>
                      <span className="bt">{c.angles?.[c.chosen_angle ?? 0]?.ko ?? c.topic}</span>
                      <span className="bmeta">{c.area} · {c.type}</span>
                      <span className="bw">{c.worth}</span>
                      <span className="bhover"><em>{c.title}</em></span>
                      {c.status === "saved" && <span className="bflag">확정</span>}
                    </Link>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="block">
        <p className="eyebrow">누적 자산</p>
        <h2>이번 주에 쌓인 실체</h2>
        <div className="insight">
          2회 이상 언급된 것만입니다. 전체로는 <b>브랜드 {ek.brand ?? 0} · 제품 {ek.product ?? 0} ·
          시술 {ek.treatment ?? 0} · 성분 {ek.ingredient ?? 0} · 병원 {ek.clinic ?? 0}</b>.
        </div>
        <div className="tablewrap"><table>
          <thead><tr><th>종류</th><th>이름</th><th>한국어</th><th className="num">언급</th><th>역할</th></tr></thead>
          <tbody>{topEnts.map((e: any) => (
            <tr key={e.kind + e.name}>
              <td><span className="kind">{e.kind}</span></td>
              <th scope="row">{e.name}</th>
              <td className="muted">{e.name_ko ?? "—"}</td>
              <td className="num">{e.n}</td>
              <td className="muted small">{e.roles}</td>
            </tr>
          ))}</tbody>
        </table></div>
      </section>
    </>
  );
}

const stats0 = (cards: any[]) => 100;

/* ───────────────────────── 쓸 소재 ───────────────────────── */

function IdeasTab({ cards }: { cards: any[] }) {
  return (
    <section className="block">
      <p className="eyebrow">콘텐츠 후보</p>
      <h2>쓸 소재 {cards.length}장</h2>
      <div className="insight">
        왼쪽은 <b>읽고 판단하는 칸</b>, 오른쪽 위 <b>English</b>로 원문 전환.
        오른쪽은 <b>만들 것을 정하는 칸</b> — 후보 하나를 고르고 메모한 뒤 확정하면 <b>글감</b> 탭으로 갑니다.
        <br />제목 아래 회색 숫자는 <b>점수 분해</b>입니다 (기본: 순위·질문·한국 / 가산: 댓글·확산·매거진).
      </div>
      {cards.map((c) => <BoardCard key={c.id} card={c} />)}
    </section>
  );
}

/* ───────────────────────── 재고 ───────────────────────── */

async function StockTab({ sub, href, runId }: any) {
  const [stock, dropped] = await Promise.all([getStock(20, runId), getStockDropped(20, runId)]);
  const filtered = sub ? stock.filter((p) => p.sub === sub) : stock;
  const top = filtered.filter((p) => p.worth >= 80);

  return (
    <section className="block">
      <p className="eyebrow">재고</p>
      <h2>카드가 안 된 나머지 {stock.length}건</h2>
      <div className="insight">
        눈에 보이는 정도가 아니라 <b>실제로 데이터화</b>돼 있습니다 — 전부 영역·유형·주제·요약·가치·키워드가 붙어 있어요.
        <b> 가치 20점 이하 {dropped}건은 목록에서 뺐습니다.</b>
        다음 주에 같은 주제가 또 뜨면 위로 올라옵니다.
      </div>

      <div className="sfilter">
        <Link href={href({ sub: undefined })} scroll={false} className={`sf${!sub ? " on" : ""}`}>전체 {stock.length}</Link>
        {SUB_ORDER.map((s) => (
          <Link key={s} href={href({ sub: s })} scroll={false} className={`sf${sub === s ? " on" : ""}`}>
            r/{s} <span className="sfn">{stock.filter((p) => p.sub === s).length}</span>
          </Link>
        ))}
      </div>

      {top.length > 0 && (
        <>
          <h4 style={{ marginTop: "1.6rem" }}>먼저 볼 것 — 가치 80점 이상 {top.length}건</h4>
          <p className="note">카드로 승격시켜도 되는 수준입니다.</p>
          <div className="tsgrid">
            {top.map((p) => (
              <div className="ts" key={p.id}>
                <div className="tsh">
                  <span className="pw">{p.worth}</span>
                  <span className="rarea">{p.area}</span>
                  <span className="rtype">{p.type}</span>
                </div>
                <a href={p.url} target="_blank" rel="noopener noreferrer">{p.title.slice(0, 70)}</a>
                <div className="ptopic">{p.topic}</div>
                <div className="rsum">{p.summary_ko.slice(0, 118)}</div>
              </div>
            ))}
          </div>
        </>
      )}

      <h4 style={{ marginTop: "2rem" }}>전체 {filtered.length}건</h4>
      <div className="rlist">
        {filtered.map((p) => (
          <div className="rrow" key={p.id}>
            <div className="rleft">
              <span className="pw">{p.worth}</span>
              <span className="rarea">{p.area}</span>
            </div>
            <div className="rmid">
              <a href={p.url} target="_blank" rel="noopener noreferrer">{p.title.slice(0, 74)}</a>
              <div className="ptopic">{p.topic}</div>
              <div className="rsum">{p.summary_ko.slice(0, 112)}</div>
              {p.keywords.length > 0 && (
                <div className="tags rkw">
                  {p.keywords.slice(0, 6).map((k) => <span className="tchip" key={k}>{k}</span>)}
                </div>
              )}
            </div>
            <div className="rtags">
              <span className="rtype">{p.type}</span>
              <span className="rsub">r/{p.sub}</span>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ───────────────────────── RSS ───────────────────────── */

async function RssTab() {
  const [feeds, items] = await Promise.all([getRssFeeds(), getRssItems(200)]);
  const mx = Math.max(...feeds.map((f) => f.n), 1);
  return (
    <section className="block">
      <p className="eyebrow">매거진</p>
      <h2>뷰티 매거진 RSS {items.length}건</h2>
      <div className="insight">
        레딧과 성격이 완전히 다릅니다. 레딧이 “소비자가 지금 떠드는 것”이라면
        이건 <b>“편집자가 검증해 내보낸 것”</b>이에요.
        점수 계산에서 <b>매거진 커버리지 가산점</b>으로 쓰이고 있습니다.
      </div>
      <h4 style={{ marginTop: "1.5rem" }}>피드별 수집 현황</h4>
      <div className="tablewrap"><table>
        <thead><tr><th>매체</th><th className="num">건수</th><th /><th>최신</th></tr></thead>
        <tbody>{feeds.map((f) => (
          <tr key={f.feed}>
            <th scope="row">{f.feed}</th>
            <td className="num">{f.n}</td>
            <td><span className="minibar" style={{ width: `${Math.round(f.n / mx * 100)}%` }} /></td>
            <td className="small muted">{f.newest}</td>
          </tr>
        ))}</tbody>
      </table></div>
      <h4 style={{ marginTop: "1.7rem" }}>최근 기사</h4>
      <div className="rlist">
        {items.map((it) => (
          <div className="rrow" key={it.url}>
            <span className="rfeed">{(it.feed ?? "").slice(0, 16)}</span>
            <div className="rmid">
              <a href={it.url} target="_blank" rel="noopener noreferrer">{it.title.slice(0, 78)}</a>
              <div className="rsum">{(it.snippet ?? "").slice(0, 120)}</div>
            </div>
            <span className="small muted">{it.day}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ───────────────────────── 나의 요청 ───────────────────────── */

async function MineTab({ areas }: any) {
  const [demands, gap, entKinds] = await Promise.all([getDemands(), getClinicGap(), getEntityKinds()]);
  const ek: Record<string, number> = Object.fromEntries(entKinds.map((e: any) => [e.kind, e.n]));
  const cmtHave = areas.reduce((s: number, a: any) => s + a.with_cmt, 0);

  return (
    <>
      <section className="block">
        <p className="eyebrow">나만의 수집</p>
        <h2>나의 요청 — 플랫폼용 데이터</h2>
        <div className="insight">
          콘텐츠 소재 발굴과 <b>별개</b>입니다. 나중에 만들 뷰티투어 플랫폼이 쓸 데이터를 지금부터 따로 모으는 자리예요.
          콘텐츠는 매주 소비되고 끝나지만 여기 쌓이는 건 사라지지 않습니다.
        </div>
      </section>

      <section className="block">
        <h2>수집 중 — 방문객 수요 프로필</h2>
        <div className="insight">이번 주 <b>{demands.length}건</b>. 나중에 코스 설계 서비스의 <b>수요 분포</b>가 됩니다.</div>
        <div className="tablewrap"><table>
          <thead><tr><th>출발지</th><th>연령</th><th>체류</th><th>예산</th><th>목표</th><th>우려</th><th /></tr></thead>
          <tbody>{demands.map((d: any) => (
            <tr key={d.mention_id}>
              <td>{d.origin ?? "—"}</td><td>{d.age_band ?? "—"}</td>
              <td>{d.stay_duration ?? "—"}</td><td>{d.budget ?? "—"}</td>
              <td className="small">{(d.goals ?? []).join(" · ")}</td>
              <td className="small muted">{(d.concerns ?? []).join(" · ") || "—"}</td>
              <td className="small"><a href={d.url} target="_blank" rel="noopener noreferrer">원문</a></td>
            </tr>
          ))}</tbody>
        </table></div>
      </section>

      <section className="block">
        <h2>구멍 — 병원 데이터가 안 쌓인다</h2>
        <div className="insight">
          플랫폼 핵심 자산은 <b>병원</b>인데 이번 주 <b>{ek.clinic ?? 0}건</b>뿐입니다.
          브랜드·제품은 본문에 나오지만 <b>병원 이름은 댓글에만</b> 나오는데, 100건 중 <b>{cmtHave}건</b>에만 댓글을 붙였어요.
        </div>
        <h4 style={{ marginTop: "1.3rem" }}>영역별 댓글 확보율</h4>
        <div className="tablewrap"><table>
          <thead><tr><th>영역</th><th className="num">글수</th><th className="num">댓글</th><th /><th className="num">비율</th></tr></thead>
          <tbody>{areas.map((a: any) => (
            <tr key={a.area}>
              <th scope="row">{a.area}</th>
              <td className="num">{a.n}</td><td className="num">{a.with_cmt}</td>
              <td><span className="minibar" style={{ width: `${Math.max(2, Math.round(a.with_cmt / a.n * 100))}%` }} /></td>
              <td className="num small muted">{Math.round(a.with_cmt / a.n * 100)}%</td>
            </tr>
          ))}</tbody>
        </table></div>
        <h4 style={{ marginTop: "1.5rem" }}>지금 바로 댓글 붙일 {gap.length}건</h4>
        <div className="tablewrap"><table>
          <thead><tr><th className="num">가치</th><th>글</th><th>유형</th></tr></thead>
          <tbody>{gap.map((g: any) => (
            <tr key={g.url}>
              <td className="num pw">{g.worth}</td>
              <th scope="row"><a href={g.url} target="_blank" rel="noopener noreferrer">{g.title.slice(0, 58)}</a></th>
              <td className="small muted">{g.type}</td>
            </tr>
          ))}</tbody>
        </table></div>
      </section>
    </>
  );
}

/* ───────────────────────── 글감 ───────────────────────── */

function DraftTab({ cards }: { cards: any[] }) {
  return (
    <section className="block">
      <p className="eyebrow">확정</p>
      <h2>글감 {cards.length}건</h2>
      <div className="insight">
        <b>쓸 소재</b> 탭에서 확정한 것만 모입니다. 고른 제목·가이드·근거·키워드·댓글·메모가 함께 담겨서
        아래 버튼으로 <b>마크다운 파일</b>로 받을 수 있어요.
      </div>
      {cards.length === 0 ? (
        <div className="empty-state">
          아직 확정한 글감이 없습니다.<br />
          <b>쓸 소재</b> 탭에서 후보를 고르고 “글감으로 확정”을 눌러 주세요.
        </div>
      ) : (
        <>
          <p><a className="dl" href="/board/export">마크다운 파일로 내려받기</a></p>
          {cards.map((c) => {
            const a = c.angles?.[c.chosen_angle ?? 0] ?? c.angles?.[0];
            return (
              <article className="card done" key={c.id}>
                <header className="chead">
                  <div className="cmeta">
                    <span className="badge">{c.sub} #{c.rank}</span>
                    <span className="badge soft">{c.area}</span>
                    <span className="worth">가치 {c.worth}</span>
                  </div>
                  <h3>{a?.ko ?? c.topic}</h3>
                  <p className="orig-link"><em>{a?.en}</em></p>
                </header>
                <div className="cgrid">
                  <div className="cleft">
                    <p className="rl">작성 가이드</p><p className="gap">{a?.guide}</p>
                    {c.gap && (<><p className="rl">왜 이 소재인가</p><p className="gap">{c.gap}</p></>)}
                    <p className="rl">원글 요약</p><p className="summary">{c.summary_ko}</p>
                  </div>
                  <div className="cright">
                    <p className="rl" style={{ marginTop: 0 }}>내 메모</p>
                    <p className="gap">{c.note || "(없음)"}</p>
                    {c.keywords.length > 0 && (
                      <>
                        <p className="rl">키워드</p>
                        <div className="tags">{c.keywords.map((k: string) => <span className="tchip" key={k}>{k}</span>)}</div>
                      </>
                    )}
                    <p className="rl">원문</p>
                    <p className="orig-link"><a href={c.url} target="_blank" rel="noopener noreferrer">{c.title} ↗</a></p>
                  </div>
                </div>
              </article>
            );
          })}
        </>
      )}
    </section>
  );
}
