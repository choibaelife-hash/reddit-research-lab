import { getWeeks, getKeywordsOf, getPicked, latestWeek, type VideoRow } from "@/lib/video/data";

const fmt = (n: number) =>
  n >= 10000 ? `${(n / 10000).toFixed(1)}만` : n.toLocaleString("ko-KR");

const hashtags = (title: string) => (title.match(/#[\p{L}\p{N}_]+/gu) ?? []).slice(0, 5);

export async function VideoTab({ week }: { week?: string }) {
  const weeks = await getWeeks();
  if (!weeks.length) {
    return (
      <section className="block">
        <p className="eyebrow">영상</p>
        <h2>영상분석</h2>
        <div className="empty-state">
          아직 수집한 영상이 없습니다.<br />
          이번 주 레딧 키워드 3개로 유튜브를 훑는 작업이 <b>월요일 새벽</b>에 돕니다.
        </div>
      </section>
    );
  }

  const w = week && weeks.includes(week) ? week : await latestWeek();
  const [kws, vids] = await Promise.all([getKeywordsOf(w), getPicked(w)]);
  const byKeyword = new Map<number, VideoRow[]>();
  for (const v of vids) {
    const k = kws.find((k) => k.keyword === v.keyword);
    if (!k) continue;
    if (!byKeyword.has(k.id)) byKeyword.set(k.id, []);
    byKeyword.get(k.id)!.push(v);
  }

  return (
    <section className="block">
      <p className="eyebrow">영상 · {w} 주</p>
      <h2>영상분석</h2>

      <div className="insight">
        이번 주 레딧에서 뽑은 <b>키워드 {kws.length}개</b>로 유튜브 <b>숏츠·최근 30일</b>을 검색해,
        <b> 아웃라이어</b>가 높은 5편씩 골랐습니다.
        아웃라이어는 <b>그 영상 조회수 ÷ 그 채널 평소 조회수</b>입니다.
        조회수 1위는 대개 채널이 커서 1위입니다. 소재가 이긴 영상을 보려면 이 값을 봐야 합니다.
      </div>

      {kws.map((k) => {
        const list = byKeyword.get(k.id) ?? [];
        const searchQuery: string | undefined = k.reason?.search_query;
        return (
          <article className="card kwcard" key={k.id}>
            <header className="chead">
              <div className="cmeta">
                <h3 style={{ marginRight: "auto" }}>{k.keyword}</h3>
                <span className="badge soft">
                  {k.reason?.source === "entity" ? "실체" : "주제"} · {k.reason?.freq}회 언급 · 평균가치 {k.reason?.avg_worth}
                </span>
                <span className="badge">숏츠 · 최근 30일 · {k.n}편 중 상위 {list.length}</span>
              </div>
              {searchQuery && (
                <p className="note small">검색어를 레딧 맥락으로 구체화: "{searchQuery}"</p>
              )}
            </header>

            <p className="rl">빈 구멍</p>
            <div className="pending"><b>2단계 대기</b> — 자막 분석이 연결되면 이 영상들이 공통으로 놓친 지점이 여기 나옵니다.</div>

            <div className="pending-row">
              <div>
                <p className="rl">썸네일 패턴</p>
                <div className="pending"><b>2단계 대기</b> — 썸네일 구도 분석 전.</div>
              </div>
              <div>
                <p className="rl">첫 15초</p>
                <div className="pending"><b>2단계 대기</b> — 훅 연출 분석 전.</div>
              </div>
            </div>

            <p className="rl">제목 후보</p>
            <div className="pending"><b>2단계 대기</b> — 위 패턴이 나온 뒤 뽑습니다.</div>

            {list.length === 0 ? (
              <div className="empty-state">조건(숏츠·최근 30일)에 맞는 영상이 없습니다.</div>
            ) : (
              <>
                <p className="rl">근거 영상 {list.length}편</p>
                <div className="pshelf">
                  {list.map((v) => {
                    const tags = hashtags(v.title);
                    return (
                      <a className="pcard" key={v.id} href={`https://www.youtube.com/watch?v=${v.video_id}`}
                         target="_blank" rel="noreferrer">
                        <div className="pthumb">
                          {v.thumbnail_url && (
                            // eslint-disable-next-line @next/next/no-img-element
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
                        <div className="ptags">
                          {tags.length
                            ? tags.map((t) => <span className="tchip" key={t}>{t}</span>)
                            : <span className="tchip">해시태그 없음</span>}
                        </div>
                      </a>
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
