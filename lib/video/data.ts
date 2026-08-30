import { pool } from "@/lib/db";
import { mondayOf } from "./keywords";

export type VideoRow = {
  id: number; video_id: string; title: string; channel_title: string;
  published_at: string; duration_sec: number; views: number;
  thumbnail_url: string; channel_median: number | null; outlier: number | null;
  like_count: number | null; keyword: string; kw_rank: number;
  transcript: string | null; thumb_desc: any | null; hook_desc: any | null;
};

export async function getWeeks(workspaceId?: string | null): Promise<string[]> {
  return (await pool.query<{ w: string }>(
    `select distinct k.week::text as w
       from video_keywords k
       left join runs r on r.id = k.run_id
      where ($1::uuid is null or r.workspace_id = $1::uuid)
      order by w desc limit 12`,
    [workspaceId ?? null]
  )).rows.map((r) => r.w);
}

export async function getKeywordsOf(week: string) {
  return (await pool.query<{ id: number; keyword: string; rank: number; score: string; reason: any; n: number }>(
    `select k.id, k.keyword, k.rank, k.score, k.reason,
            (select count(*)::int from video_candidates c where c.keyword_id = k.id) as n
       from video_keywords k where k.week = $1::date order by k.rank`,
    [week]
  )).rows;
}

export async function getPicked(week: string): Promise<VideoRow[]> {
  return (await pool.query<VideoRow>(
    `select c.id, c.video_id, c.title, c.channel_title, c.published_at::text,
            c.duration_sec, c.views, c.thumbnail_url, c.channel_median, c.outlier,
            c.like_count, k.keyword, k.rank as kw_rank,
            a.transcript, a.thumb_desc, a.hook_desc
       from video_candidates c
       join video_keywords k on k.id = c.keyword_id
       left join video_analysis a on a.video_pk = c.id
      where c.week = $1::date and c.picked
      order by k.rank, c.outlier desc nulls last`,
    [week]
  )).rows;
}

// 2단계 종합. 키워드 단위라 video_analysis(영상 단위)와 따로 조회한다.
export type SynthesisRow = {
  keyword_id: number; empty_gap: string | null; thumbnail_pattern: string | null;
  hook_pattern: string | null; title_candidates: string[] | null;
};

// pg는 bigint를 문자열로 준다. 키를 문자열로 통일하지 않으면 조회가 항상 빗나간다.
export async function getSynthesis(week: string): Promise<Map<string, SynthesisRow>> {
  const r = await pool.query<SynthesisRow>(
    `select s.keyword_id, s.empty_gap, s.thumbnail_pattern, s.hook_pattern, s.title_candidates
       from video_keyword_analysis s
       join video_keywords k on k.id = s.keyword_id
      where k.week = $1::date`,
    [week]
  );
  return new Map(r.rows.map((x) => [String(x.keyword_id), x]));
}

export const latestWeek = async () => (await getWeeks())[0] ?? mondayOf();
