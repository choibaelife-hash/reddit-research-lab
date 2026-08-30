import Link from "next/link";
import { getWeeks, getKeywordsOf, getPicked, getSynthesis, latestWeek, type VideoRow } from "@/lib/video/data";
import { currentWorkspace } from "@/lib/workspace";
import { firstLines } from "@/lib/video/synthesize";

const fmt = (n: number) =>
  n >= 10000 ? `${(n / 10000).toFixed(1)}만` : n.toLocaleString("ko-KR");

const daysAgo = (iso: string) =>
  Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 86400000));

export async function VideoTab({ week, video }: { week?: string; video?: string }) {
  const ws = await currentWorkspace();
  const weeks = await getWeeks(ws?.id ?? null);
  if (!weeks.length) {
    return (
      <section className="block">
        <p className="eyebrow">유튜브</p>
        <h2>아웃라이어 브리핑</h2>
        <div className="empty-state">
          아직 수집한 영상이 없습니다.<br />
          이번 주 레딧 키워드 3개로 유튜브를 훑는 작업이 <b>월요일 새벽</b>에 돕니다.
        </div>
      </section>
    );
  }

  const w = week && weeks.includes(week) ? week : await latestWeek();
  const [kws, vids, synth] = await Promise.all([getKeywordsOf(w), getPicked(w), getSynthesis(w)]);

  // 영상 하나를 열었으면 상세만 보여준다. URL에 남아 뒤로가기와 공유가 동작한다.
  const open = video ? vids.find((v) => v.video_id === video) : undefined;
  if (open) return <Detail v={open} week={w} />;

  const byKeyword = new Map<string, VideoRow[]>();
  for (const v of vids) {
    const k = kws.find((k) => k.keyword === v.keyword);
    if (!k) continue;
    const kid = String(k.id);
    if (!byKeyword.has(kid)) byKeyword.set(kid, []);
    byKeyword.get(kid)!.push(v);
  }

  return (
    <section className="block">
      <p className="eyebrow">유튜브 · {w} 주</p>
      <h2>아웃라이어 브리핑</h2>

      <div className="insight">
        레딧 키워드 <b>{kws.length}개</b>로 유튜브 <b>숏츠 · 최근 30일</b>을 검색해,
        <b> 아웃라이어</b>가 높은 영상만 골랐습니다.
        아웃라이어는 <b>그 영상 조회수 ÷ 그 채널 평소 조회수</b>입니다 —
        조회수 1위는 대개 채널이 커서 1위지만, 이 값이 높으면 소재가 이긴 것입니다.
      </div>

      {kws.map((k) => {
        const list = byKeyword.get(String(k.id)) ?? [];
        const s = synth.get(String(k.id));
        const outs = list.map((v) => Number(v.outlier)).filter(Number.isFinite);
        const q: string | undefined = k.reason?.search_query;

        return (
          <article className="card kwcard" key={k.id}>
            <header className="chead">
              <div className="cmeta">
                <h3 style={{ marginRight: "auto" }}>{k.keyword}</h3>
                <span className="badge soft">
                  {k.reason?.source === "entity" ? "실체" : "주제"} · {k.reason?.freq}회 언급 · 평균가치 {k.reason?.avg_worth}
                </span>
                {outs.length > 0 && (
                  <span className="badge">
                    아웃라이어 {Math.min(...outs).toFixed(1)}~{Math.max(...outs).toFixed(1)}배
                  </span>
                )}
              </div>
              {q && <p className="note small">검색어를 레딧 맥락으로 구체화: &ldquo;{q}&rdquo;</p>}
            </header>

            <p className="rl hole">빈 구멍 <span className="sub2">한국인이 답할 수 있는 지점</span></p>
            {s?.empty_gap
              ? <div className="gapbox">{s.empty_gap}</div>
              : <div className="pending"><b>분석 대기</b> — 이 키워드의 영상이 모두 분석돼야 나옵니다.</div>}

            <div className="pending-row">
              <div>
                <p className="rl">썸네일 패턴</p>
                {s?.thumbnail_pattern
                  ? <div className="filledbox">{s.thumbnail_pattern}</div>
                  : <div className="pending"><b>분석 대기</b></div>}
              </div>
              <div>
                <p className="rl">첫 15초</p>
                {s?.hook_pattern
                  ? <div className="filledbox">{s.hook_pattern}</div>
                  : <div className="pending"><b>분석 대기</b></div>}
              </div>
            </div>

            <p className="rl">제목 후보</p>
            {s?.title_candidates?.length
              ? <ol className="titles">{s.title_candidates.map((t) => <li key={t}>{t}</li>)}</ol>
              : <div className="pending"><b>분석 대기</b></div>}

            {list.length === 0 ? (
              <div className="empty-state">조건(숏츠 · 최근 30일 · 영어)에 맞는 영상이 없습니다.</div>
            ) : (
              <>
                <p className="rl">근거 영상 {list.length}편 <span className="sub2">누르면 상세 분석</span></p>
                <div className="pshelf">
                  {list.map((v) => {
                    const texts: string[] = (v.thumb_desc?.texts ?? [])
                      .map((t: any) => t.content).filter(Boolean).slice(0, 2);
                    return (
                      <Link className="pcard" key={v.id}
                            href={`/board?tab=video&week=${w}&v=${v.video_id}`}>
                        <div className="pthumb">
                          {v.thumbnail_url && (
                            /* eslint-disable-next-line @next/next/no-img-element */
                            <img src={v.thumbnail_url} alt="" />
                          )}
                          <span className="pdur">{v.duration_sec}초</span>
                          {v.outlier != null && <span className="pout">{v.outlier}배</span>}
                        </div>
                        <div className="ptitle">{v.title}</div>
                        <div className="pmeta">
                          {v.channel_title} · {fmt(v.views)}
                          {v.channel_median != null && ` (평소 ${fmt(v.channel_median)})`}
                        </div>
                        {texts.length > 0 && (
                          <div className="ptags">
                            {texts.map((t) => <span className="tchip on" key={t}>&ldquo;{t}&rdquo;</span>)}
                          </div>
                        )}
                      </Link>
                    );
                  })}
                </div>
              </>
            )}
          </article>
        );
      })}
    </section>
  );
}

// 모델은 확실하지 않을 때 "unknown"을 쓰라고 지시받았다. 그걸 화면에 그대로 내보내면
// 글자가 없는 썸네일이 «"unknown"»이라는 문구를 가진 것처럼 보인다.
const real = (s: unknown) => typeof s === "string" && s.trim() && s.toLowerCase() !== "unknown";

// Whisper는 말이 없고 음악만 있으면 "Music" 한 단어를 돌려준다. 대사가 아니다.
const NO_SPEECH = /^(music|음악|\[music\]|\(music\)|thank you\.?)$/i;

function Detail({ v, week }: { v: VideoRow; week: string }) {
  const t = v.thumb_desc, h = v.hook_desc;
  const texts: any[] = (t?.texts ?? []).filter((x: any) => real(x?.content));
  const beats: any[] = h?.beats ?? [];
  const spoken = v.transcript && !NO_SPEECH.test(v.transcript.trim()) ? v.transcript : null;
  const lines = firstLines(spoken);
  const likeRate = v.like_count && v.views
    ? ((Number(v.like_count) / Number(v.views)) * 100).toFixed(2) : null;

  return (
    <section className="block">
      <div className="dhead">
        <Link className="vd-back" href={`/board?tab=video&week=${week}`}>← 브리핑으로</Link>
        <a className="ytlink" href={`https://www.youtube.com/watch?v=${v.video_id}`}
           target="_blank" rel="noreferrer">유튜브에서 보기 ↗</a>
      </div>

      <div className="dtop">
        <div className="dthumb">
          {v.thumbnail_url && (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={v.thumbnail_url} alt="" />
          )}
        </div>
        <div>
          <h3>{v.title}</h3>
          <div className="dmeta">
            {v.channel_title} · {v.duration_sec}초 · {daysAgo(v.published_at)}일 전<br />
            조회 {fmt(v.views)}{v.channel_median != null && ` · 채널 평소 ${fmt(v.channel_median)}`}<br />
            <b className="worth">아웃라이어 {v.outlier ?? "—"}배</b>
            {likeRate && ` · 좋아요율 ${likeRate}%`}
          </div>
        </div>
      </div>

      <p className="rl">썸네일에 쓰인 문구</p>
      {texts.length === 0 ? (
        <p className="note small">이 썸네일에는 읽어낼 글자가 없습니다.</p>
      ) : (
        <>
          <div className="texts">
            {texts.map((x, i) => (
              <div className="trow" key={i}>
                {x.position && <span className="tpos">{x.position}</span>}
                <span className="tc">&ldquo;{x.content}&rdquo;</span>
                {x.color && x.color !== "unknown" && <span className="tmeta">{x.color}</span>}
              </div>
            ))}
          </div>
        </>
      )}

      <p className="rl">첫 대사 <span className="sub2">말문을 어떻게 열었나</span></p>
      {lines.length === 0 ? (
        <p className="note small">말소리가 없는 영상입니다 — 음악·자막만으로 진행됩니다.</p>
      ) : (
        <ol className="titles">{lines.map((l, i) => <li key={i}>{l}</li>)}</ol>
      )}

      {beats.length > 0 && (
        <>
          <p className="rl">첫 15초</p>
          <div className="vd-beats">
            {beats.map((b, i) => (
              <div className="vd-beat" key={i}>
                <div className="vd-bt">{b.t}초</div>
                <div className="vd-bw">{b.what}</div>
              </div>
            ))}
          </div>
          <div className="parts">
            {h?.subject_on_screen_at != null && <span>대상 첫 등장 <b>{h.subject_on_screen_at}초</b></span>}
            {h?.closeup_at != null && <span>클로즈업 <b>{h.closeup_at}초</b></span>}
          </div>
        </>
      )}

      {spoken && (
        <>
          <p className="rl">첫 15초 대사 전문</p>
          <div className="mono">{spoken}</div>
        </>
      )}
    </section>
  );
}
