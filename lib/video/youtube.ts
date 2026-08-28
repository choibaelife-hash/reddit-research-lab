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
  // 아래는 videos 응답에 이미 들어 있던 것을 안 읽고 버리던 값들이다(11장 #12).
  // like_count는 참여율(좋아요÷조회수) 계산에 쓴다 — 조회수는 돈으로 사도 이 비율은 못 산다.
  like_count: number | null; comment_count: number | null;
  description: string | null; category_id: string | null;
  channel_max: number | null; outlier_confidence: string | null;
  audio_language: string | null; default_language: string | null;
};

// 영어권 시장을 보는 기능이므로 실제로 영어를 말하는 영상만 남긴다(2026-08-28).
// `relevanceLanguage=en`은 검색 힌트일 뿐이라 아랍어·스페인어·터키어가 섞여 들어왔다.
//
// 음성 언어를 우선한다 — 제목만 영어고 말은 타밀어·힌디어인 영상이 실제로 있었다.
// 훅과 대사를 참고하려는 목적이라 소리가 영어가 아니면 쓸모가 없다.
// 둘 다 없으면 제목의 문자만 본다(라틴 문자가 아니면 뺀다).
const NON_LATIN = /[؀-ۿЀ-ӿ֐-׿฀-๿ऀ-ॿ一-鿿぀-ヿ가-힯]/;

function isEnglishMarket(v: { audio_language: string | null; default_language: string | null; title: string }) {
  const lang = v.audio_language ?? v.default_language;
  if (lang) return lang.toLowerCase().startsWith("en");
  return !NON_LATIN.test(v.title);
}

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

// 채널의 평소 조회수.
//
// 평균이 아니라 중앙값인 이유: 한 편이 대박나면 평균이 끌려 올라가
// 그 채널의 모든 영상이 "평범"해 보이게 된다.
//
// 두 가지를 2026-08-28에 고쳤다(03-VIDEO.md 11장 #10·#11).
//  #10 예전에는 숏츠와 롱폼을 섞어 중앙값을 냈다. 형식이 다르면 조회수 분포도 달라
//      숏츠를 롱폼 섞인 중앙값과 비교하는 셈이었다. 이제 숏츠만 골라 쓴다.
//  #11 중앙값은 양봉분포(대부분 실패 + 일부 대박)를 대표하지 못한다.
//      Tira 실측: 최근 10편이 212~1,406과 281,228~1,620,991로 갈렸고
//      중앙값 1,185가 그 사이 빈 구간에 떨어져 1,364배가 나왔다.
//      최댓값을 같이 보고, 격차가 크면 신뢰도를 낮춘다.
//
// 비용은 그대로다. playlistItems·videos 모두 호출당 1 unit이라 25편을 받아도 같다.
export type ChannelStats = { median: number; max: number; confidence: "high" | "low"; basis: "shorts" | "mixed" };

const channelCache = new Map<string, ChannelStats>();
const NONE: ChannelStats = { median: 0, max: 0, confidence: "low", basis: "mixed" };

// 분모가 이 값보다 작으면 배율이 요동친다.
// 실측: 중앙값 38인 채널에서 100,429배가 나왔다.
const MIN_MEDIAN = 500;
// 최댓값이 중앙값의 이 배수를 넘으면 중앙값이 대표성을 잃은 것으로 본다.
const BIMODAL_RATIO = 100;

async function channelStats(channelId: string): Promise<ChannelStats> {
  if (channelCache.has(channelId)) return channelCache.get(channelId)!;

  const ch = await get("channels", { part: "contentDetails", id: channelId });
  const uploads = ch.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
  if (!uploads) return NONE;

  // 25편을 받아 그중 숏츠만 고른다. maxResults를 늘려도 1 unit이라 공짜다.
  const pl = await get("playlistItems", { part: "contentDetails", playlistId: uploads, maxResults: "25" });
  const ids = (pl.items ?? []).map((i: any) => i.contentDetails.videoId).filter(Boolean);
  if (!ids.length) return NONE;

  const vs = await get("videos", { part: "statistics,contentDetails", id: ids.slice(0, 50).join(",") });
  const items: { views: number; sec: number }[] = (vs.items ?? []).map((v: any) => ({
    views: Number(v.statistics?.viewCount ?? 0),
    sec: parseDuration(v.contentDetails?.duration),
  }));

  // 숏츠가 너무 적으면 중앙값이 더 흔들리므로 그때는 전체로 돌아간다.
  const shorts = items.filter((x) => x.sec < 60);
  const basis: ChannelStats["basis"] = shorts.length >= 4 ? "shorts" : "mixed";
  const views = (basis === "shorts" ? shorts : items).map((x) => x.views);
  if (!views.length) return NONE;

  const m = median(views);
  const mx = Math.max(...views);
  const confidence: ChannelStats["confidence"] =
    m < MIN_MEDIAN || (m > 0 && mx / m > BIMODAL_RATIO) ? "low" : "high";

  const stats = { median: m, max: mx, confidence, basis };
  channelCache.set(channelId, stats);
  return stats;
}

export async function searchKeyword(keyword: string, opts: {
  days?: number; minViews?: number; max?: number;
} = {}): Promise<{ candidates: Candidate[]; unitsUsed: number }> {
  // 최종 산출물이 숏츠 제작 가이드라 최근 30일 · 짧은 영상으로 좁힌다(2026-08-27 결정).
  // videoDuration=short는 유튜브 기준 4분 미만 — 진짜 쇼츠(<60초) 여부는 pickTop에서 다시 거른다.
  const { days = 30, minViews = 1000, max = 50 } = opts;
  let units = 0;

  const after = new Date(Date.now() - days * 86400_000).toISOString();
  const search = await get("search", {
    part: "snippet", q: keyword, type: "video", maxResults: String(Math.min(max, 50)),
    order: "viewCount", publishedAfter: after, relevanceLanguage: "en", videoDuration: "short",
  });
  units += COST.search;

  const ids = (search.items ?? []).map((i: any) => i.id?.videoId).filter(Boolean);
  if (!ids.length) return { candidates: [], unitsUsed: units };

  // 검색 결과엔 조회수가 없다. videos로 한 번 더 받아야 한다.
  const det = await get("videos", { part: "snippet,statistics,contentDetails", id: ids.join(",") });
  units += COST.videos;

  const rows: Candidate[] = [];
  let droppedLang = 0;
  for (const v of det.items ?? []) {
    const views = Number(v.statistics?.viewCount ?? 0);
    if (views < minViews) continue;   // 표본이 작으면 아웃라이어가 요동친다

    const audio = v.snippet.defaultAudioLanguage ?? null;
    const dflt = v.snippet.defaultLanguage ?? null;
    if (!isEnglishMarket({ audio_language: audio, default_language: dflt, title: v.snippet.title })) {
      droppedLang++;
      continue;
    }

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
      like_count: v.statistics?.likeCount != null ? Number(v.statistics.likeCount) : null,
      comment_count: v.statistics?.commentCount != null ? Number(v.statistics.commentCount) : null,
      description: v.snippet.description ?? null,
      category_id: v.snippet.categoryId ?? null,
      channel_max: null,
      outlier_confidence: null,
      audio_language: audio,
      default_language: dflt,
    });
  }
  if (droppedLang) console.log(`[youtube] "${keyword}" 비영어 ${droppedLang}편 제외`);

  // 채널 통계는 조회 비용이 있으니 상위 후보에만 매긴다.
  const top = [...rows].sort((a, b) => b.views - a.views).slice(0, 20);
  for (const r of top) {
    const s = await channelStats(r.channel_id);
    units += COST.playlistItems + COST.videos + 1;
    r.channel_median = s.median;
    r.channel_max = s.max;
    r.outlier = s.median > 0 ? Number((r.views / s.median).toFixed(2)) : null;
    r.outlier_confidence = s.median > 0 ? s.confidence : "low";
  }

  return { candidates: rows, unitsUsed: units };
}

// 최종 산출물이 숏츠 제작 가이드라 롱폼은 뺀다(2026-08-27 결정, 03-VIDEO.md 2장).
//
// 신뢰도 낮은 배율은 뒤로 미룬다(2026-08-28). 분모가 작거나 채널이 양봉분포면
// 배율이 폭발해 상위를 독식한다 — 실측에서 중앙값 38인 채널이 100,429배로 1위였다.
// 다만 아예 버리지는 않는다. 고신뢰만으로 5편이 안 차면 저신뢰로 채운다.
export function pickTop(cands: Candidate[], n = 5): Candidate[] {
  const usable = cands.filter((c) => c.outlier != null && c.duration_sec < 60);
  const byOutlier = (a: Candidate, b: Candidate) => b.outlier! - a.outlier!;
  const high = usable.filter((c) => c.outlier_confidence !== "low").sort(byOutlier);
  const low = usable.filter((c) => c.outlier_confidence === "low").sort(byOutlier);
  return [...high, ...low].slice(0, n);
}

export async function saveCandidates(week: string, keywordId: number, cands: Candidate[], picked: Candidate[]) {
  const pickedIds = new Set(picked.map((p) => p.video_id));
  // 재실행 시 이번에 다시 안 뽑힌 영상이 예전 picked=true로 남지 않게 먼저 초기화한다.
  await pool.query(`update video_candidates set picked = false where week = $1 and keyword_id = $2`, [week, keywordId]);
  for (const c of cands) {
    await pool.query(
      `insert into video_candidates
         (week, keyword_id, video_id, title, channel_id, channel_title, published_at,
          duration_sec, views, thumbnail_url, channel_median, outlier, picked,
          like_count, comment_count, description, category_id, channel_max, outlier_confidence,
          audio_language, default_language)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
       on conflict (week, video_id) do update set
         views = excluded.views, channel_median = excluded.channel_median,
         outlier = excluded.outlier, picked = excluded.picked,
         like_count = excluded.like_count, comment_count = excluded.comment_count,
         description = excluded.description, category_id = excluded.category_id,
         channel_max = excluded.channel_max, outlier_confidence = excluded.outlier_confidence,
         audio_language = excluded.audio_language, default_language = excluded.default_language`,
      [week, keywordId, c.video_id, c.title, c.channel_id, c.channel_title, c.published_at,
       c.duration_sec, c.views, c.thumbnail_url, c.channel_median, c.outlier,
       pickedIds.has(c.video_id),
       c.like_count, c.comment_count, c.description, c.category_id,
       c.channel_max, c.outlier_confidence, c.audio_language, c.default_language]
    );
  }
}
