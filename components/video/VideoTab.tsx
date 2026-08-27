import { getWeeks, getKeywordsOf, getPicked, latestWeek } from "@/lib/video/data";

const fmt = (n: number) =>
  n >= 10000 ? `${(n / 10000).toFixed(1)}만` : n.toLocaleString("ko-KR");

const dur = (s: number) =>
  s < 60 ? `${s}초` : `${Math.floor(s / 60)}분 ${s % 60 ? `${s % 60}초` : ""}`.trim();

export async function VideoTab({ week }: { week?: string }) {
  const weeks = await getWeeks();
  if (!weeks.length) {
    return (
      <section className="block">
        <p className="eyebrow">영상</p>
        <h2>영상분석</h2>
        <div className="empty-state">
          아직 수집한 영상이 없습니다.<br />
          이번 주 레딧 키워드 5개로 유튜브를 훑는 작업이 <b>월요일 새벽</b>에 돕니다.
        </div>
      </section>
    );
  }

  const w = week && weeks.includes(week) ? week : await latestWeek();
  const [kws, vids] = await Promise.all([getKeywordsOf(w), getPicked(w)]);

  return (
    <section className="block">
      <p className="eyebrow">영상 · {w} 주</p>
      <h2>영상분석 {vids.length}편</h2>

      <div className="insight">
        이번 주 레딧에서 뽑은 <b>키워드 {kws.length}개</b>로 유튜브를 검색해,
        <b> 아웃라이어</b>가 높은 영상만 골랐습니다.
        아웃라이어는 <b>그 영상 조회수 ÷ 그 채널 평소 조회수</b>입니다.
        조회수 1위는 대개 채널이 커서 1위입니다. 소재가 이긴 영상을 보려면 이 값을 봐야 합니다.
      </div>

      <div className="tablewrap">
        <table className="tsmall">
          <thead><tr><th>#</th><th>키워드</th><th>선정 근거</th><th>수집</th></tr></thead>
          <tbody>
            {kws.map((k) => (
              <tr key={k.id}>
                <td>{k.rank}</td>
                <td><b>{k.keyword}</b></td>
                <td className="small">
                  {k.reason?.freq}회 언급 · 평균가치 {k.reason?.avg_worth}
                  <span className="badge soft">{k.reason?.source === "entity" ? "실체" : "주제"}</span>
                </td>
                <td>{k.n}편</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {vids.length === 0 ? (
        <div className="empty-state">조건에 맞는 영상이 없습니다. 필터가 너무 좁을 수 있습니다.</div>
      ) : (
        vids.map((v) => (
          <article className="card" key={v.id}>
            <header className="chead">
              <div className="cmeta">
                <span className="badge">{v.keyword}</span>
                <span className="badge soft">{v.duration_sec < 60 ? "쇼츠" : "롱폼"}</span>
                {v.outlier != null && (
                  <span className="badge" title="조회수 ÷ 채널 평소 조회수">
                    아웃라이어 {v.outlier}배
                  </span>
                )}
              </div>
            </header>

            <div className="cols">
              <div className="cleft">
                {v.thumbnail_url && (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img src={v.thumbnail_url} alt="" style={{ width: "100%", borderRadius: 6 }} />
                )}
              </div>
              <div className="cright">
                <h3>
                  <a className="orig-link" href={`https://www.youtube.com/watch?v=${v.video_id}`}
                     target="_blank" rel="noreferrer">{v.title}</a>
                </h3>
                <p className="cmeta small">
                  {v.channel_title} · {dur(v.duration_sec)} · {v.published_at.slice(0, 10)}
                </p>
                <div className="parts">
                  <span>조회 <b>{fmt(v.views)}</b></span>
                  {v.channel_median != null && <span>채널 평소 <b>{fmt(v.channel_median)}</b></span>}
                </div>
                <p className="note small">
                  분석(자막·썸네일·훅)은 다음 단계에서 붙습니다.
                </p>
              </div>
            </div>
          </article>
        ))
      )}
    </section>
  );
}
