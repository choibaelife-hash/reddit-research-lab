import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { analyzeVideo } from "@/lib/video/analyze";
import { synthesizeKeyword } from "@/lib/video/synthesize";
import { mondayOf } from "@/lib/video/keywords";

// 2단계 진입점. 1단계(/api/cron/video)와 분리한다 — 1단계는 Vercel에서 계속 돌지만
// 2단계는 시간이 길어 Railway로 가야 한다(03-VIDEO.md 7장).
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const week = req.nextUrl.searchParams.get("week") ?? mondayOf();
  // 한 번에 몇 편까지 볼지. 로컬 실험에서 조금씩 돌려보려고 열어둔다.
  const limit = Number(req.nextUrl.searchParams.get("limit") ?? 5);
  const redo = req.nextUrl.searchParams.get("redo") === "1";

  try {
    const { rows: todo } = await pool.query(
      `select c.id, c.video_id, c.thumbnail_url, c.title, c.keyword_id
         from video_candidates c
         left join video_analysis a on a.video_pk = c.id
        where c.week = $1::date and c.picked ${redo ? "" : "and a.video_pk is null"}
        order by c.outlier desc nulls last
        limit $2`,
      [week, limit]
    );

    const done: any[] = [];
    for (const v of todo) {
      const r = await analyzeVideo(v);
      done.push({
        title: v.title.slice(0, 60),
        transcript: r.transcript ? `${r.transcript.length}자` : null,
        thumb: Boolean(r.thumb_desc),
        hook: Boolean(r.hook_desc),
        failed: r.failed,
      });
    }

    // 5편이 모두 끝난 키워드만 종합한다. 부분 자료로 "5편 중 4편"을 세면 틀린다.
    const { rows: ready } = await pool.query(
      `select k.id, k.keyword
         from video_keywords k
        where k.week = $1::date
          and not exists (
            select 1 from video_candidates c
             left join video_analysis a on a.video_pk = c.id
             where c.keyword_id = k.id and c.picked and a.video_pk is null)
          and exists (select 1 from video_candidates c where c.keyword_id = k.id and c.picked)`,
      [week]
    );

    const synthesized: any[] = [];
    for (const k of ready) {
      const s = await synthesizeKeyword(k.id);
      if (s) synthesized.push({ keyword: k.keyword, ...s });
    }

    return NextResponse.json({ week, analyzed: done.length, videos: done, synthesized });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message ?? e) }, { status: 500 });
  }
}
