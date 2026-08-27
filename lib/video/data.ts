import { pool } from "@/lib/db";
import { mondayOf } from "./keywords";

export type VideoRow = {
  id: number; video_id: string; title: string; channel_title: string;
  published_at: string; duration_sec: number; views: number;
  thumbnail_url: string; channel_median: number | null; outlier: number | null;
  keyword: string; kw_rank: number;
};

export async function getWeeks(): Promise<string[]> {
  return (await pool.query<{ w: string }>(
    `select distinct week::text as w from video_keywords order by w desc limit 12`
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
            k.keyword, k.rank as kw_rank
       from video_candidates c join video_keywords k on k.id = c.keyword_id
      where c.week = $1::date and c.picked
      order by k.rank, c.outlier desc nulls last`,
    [week]
  )).rows;
}

export const latestWeek = async () => (await getWeeks())[0] ?? mondayOf();
