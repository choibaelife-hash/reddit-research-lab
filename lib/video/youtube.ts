import { pool } from "@/lib/db";

// 유튜브에서 키워드별 영상을 모으고 아웃라이어 점수를 매긴다.
//
// ★ 이 파일의 핵심은 조회수가 아니라 아웃라이어다.
//   조회수 1위는 대개 "소재가 좋아서"가 아니라 "채널이 커서" 1위다.
//   구독자 220만 채널의 48만뷰(평소 42만)보다
//   구독자 8천 채널의 31만뷰(평소 4천)가 참고할 가치가 훨씬 크다.
//   PRD 5.3에서 레딧 top 순위가 소재 가치와 무관했던 것과 같은 함정이다.

const API = "https://www.googleapis.com/youtube/v3";

// 할당량: 하루 10,000 units. search=100, videos=1, playlistItems=1.
// 키워드 1개당 약 110 units 쓴다. 5개면 550 — 하루 한도의 5.5%.
const COST = { search: 100, videos: 1, playlistItems: 1 };

export type Candidate = {
  video_id: string; title: string; channel_id: string; channel_title: string;
  published_at: string; duration_sec: number; views: number; thumbnail_url: string;
  channel_median: number | null; outlier: number | null;
};

function key() {
  const k = process.env.YOUTUBE_API_KEY;
  if (!k) throw new Error("YOUTUBE_API_KEY 없음");
  return k;
}

async function get(path: string, params: Record<string, string>) {
  const q = new URLSearchParams({ ...params, key: key() });
  const res = await fetch(`${API}/${path}?${q}`);
  if (!res.ok) {
    const body = await res.text();
    // 할당량 초과는 조용히 넘기면 안 된다. 다음 날까지 아무것도 안 돈다.
    throw new Error(`youtube ${path} ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

// PT1M30S → 90
function parseDuration(iso: string): number {
  const m = /PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(iso || "");
  if (!m) return 0;
  return (+(m[1] || 0)) * 3600 + (+(m[2] || 0)) * 60 + (+(m[3] || 0));
}

const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const i = s.length >> 1;
  return s.length % 2 ? s[i] : Math.round((s[i - 1] + s[i]) / 2);
};

// 채널의 평소 조회수. 최근 업로드 10개의 중앙값을 쓴다.
// 평균이 아니라 중앙값인 이유: 한 편이 대박나면 평균이 끌려 올라가
// 그 채널의 모든 영상이 "평범"해 보이게 된다.
const channelMedianCache = new Map<string, number>();

async function channelMedian(channelId: string): Promise<number> {
  if (channelMedianCache.has(channelId)) return channelMedianCache.get(channelId)!;

  const ch = await get("channels", { part: "contentDetails", id: channelId });
  const uploads = ch.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
  if (!uploads) return 0;

  const pl = await get("playlistItems", { part: "contentDetails", playlistId: uploads, maxResults: "10" });
  const ids = (pl.items ?? []).map((i: any) => i.contentDetails.videoId).filter(Boolean);
  if (!ids.length) return 0;

  const vs = await get("videos", { part: "statistics", id: ids.join(",") });
  const views = (vs.items ?? []).map((v: any) => Number(v.statistics?.viewCount ?? 0));

  const m = median(views);
  channelMedianCache.set(channelId, m);
  return m;
}

export async function searchKeyword(keyword: string, opts: {
  days?: number; minViews?: number; max?: number;
} = {}): Promise<{ candidates: Candidate[]; unitsUsed: number }> {
  const { days = 90, minViews = 1000, max = 50 } = opts;
  let units = 0;

  const after = new Date(Date.now() - days * 86400_000).toISOString();
  const search = await get("search", {
    part: "snippet", q: keyword, type: "video", maxResults: String(Math.min(max, 50)),
    order: "viewCount", publishedAfter: after, relevanceLanguage: "en",
  });
  units += COST.search;

  const ids = (search.items ?? []).map((i: any) => i.id?.videoId).filter(Boolean);
  if (!ids.length) return { candidates: [], unitsUsed: units };

  // 검색 결과엔 조회수가 없다. videos로 한 번 더 받아야 한다.
  const det = await get("videos", { part: "snippet,statistics,contentDetails", id: ids.join(",") });
  units += COST.videos;

  const rows: Candidate[] = [];
  for (const v of det.items ?? []) {
    const views = Number(v.statistics?.viewCount ?? 0);
    if (views < minViews) continue;   // 표본이 작으면 아웃라이어가 요동친다

    rows.push({
      video_id: v.id,
      title: v.snippet.title,
      channel_id: v.snippet.channelId,
      channel_title: v.snippet.channelTitle,
      published_at: v.snippet.publishedAt,
      duration_sec: parseDuration(v.contentDetails?.duration),
      views,
      thumbnail_url: v.snippet.thumbnails?.high?.url ?? v.snippet.thumbnails?.default?.url ?? "",
      channel_median: null,
      outlier: null,
    });
  }

  // 채널 중앙값은 조회 비용이 있으니 상위 후보에만 매긴다.
  const top = [...rows].sort((a, b) => b.views - a.views).slice(0, 20);
  for (const r of top) {
    const m = await channelMedian(r.channel_id);
    units += COST.playlistItems + COST.videos + 1;
    r.channel_median = m;
    r.outlier = m > 0 ? Number((r.views / m).toFixed(2)) : null;
  }

  return { candidates: rows, unitsUsed: units };
}

// 쇼츠와 롱폼은 성격이 달라 따로 고른다. 섞으면 쇼츠가 아웃라이어를 독식한다.
export function pickTop(cands: Candidate[], n = 5): Candidate[] {
  const scored = cands.filter((c) => c.outlier != null);
  const shorts = scored.filter((c) => c.duration_sec < 60).sort((a, b) => b.outlier! - a.outlier!);
  const longs  = scored.filter((c) => c.duration_sec >= 60).sort((a, b) => b.outlier! - a.outlier!);

  const out: Candidate[] = [];
  const half = Math.ceil(n / 2);
  out.push(...longs.slice(0, half), ...shorts.slice(0, n - half));

  // 한쪽이 부족하면 다른 쪽에서 채운다.
  if (out.length < n) {
    const rest = scored.filter((c) => !out.includes(c)).sort((a, b) => b.outlier! - a.outlier!);
    out.push(...rest.slice(0, n - out.length));
  }
  return out.slice(0, n);
}

export async function saveCandidates(week: string, keywordId: number, cands: Candidate[], picked: Candidate[]) {
  const pickedIds = new Set(picked.map((p) => p.video_id));
  for (const c of cands) {
    await pool.query(
      `insert into video_candidates
         (week, keyword_id, video_id, title, channel_id, channel_title, published_at,
          duration_sec, views, thumbnail_url, channel_median, outlier, picked)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       on conflict (week, video_id) do update set
         views = excluded.views, channel_median = excluded.channel_median,
         outlier = excluded.outlier, picked = excluded.picked`,
      [week, keywordId, c.video_id, c.title, c.channel_id, c.channel_title, c.published_at,
       c.duration_sec, c.views, c.thumbnail_url, c.channel_median, c.outlier,
       pickedIds.has(c.video_id)]
    );
  }
}
