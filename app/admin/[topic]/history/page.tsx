import { pool } from "@/lib/db";
import { topicToCategories } from "@/lib/topics";

type SourceStatus = {
  source: string;
  last_success_at: string | null;
  last_count: number | null;
  state: string;
};

function timeAgo(iso: string | null) {
  if (!iso) return "아직 없음";
  const diffMin = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (diffMin < 60) return `${diffMin}분 전`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH}시간 전`;
  return `${Math.floor(diffH / 24)}일 전`;
}

function Container({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ border: "1px solid #eee", borderRadius: 8, padding: "1.25rem", marginBottom: 24 }}>
      <h2 className="font-serif" style={{ fontSize: 16, marginBottom: 12 }}>
        {title}
      </h2>
      {children}
    </section>
  );
}

function SourceStatusCard({ status }: { status: SourceStatus | undefined }) {
  return (
    <div style={{ fontSize: 13 }}>
      <span
        style={{
          fontSize: 11,
          padding: "1px 8px",
          borderRadius: 999,
          background: status?.state === "ok" || !status ? "#e8f0e6" : "#fbe2e2",
          color: status?.state === "ok" || !status ? "#2d4a28" : "#7a2020",
          marginRight: 8,
        }}
      >
        {status?.state ?? "미실행"}
      </span>
      마지막 성공 {timeAgo(status?.last_success_at ?? null)}
      {status?.last_count != null ? ` · ${status.last_count}건 수집` : ""}
    </div>
  );
}

export default async function HistoryPage({ params }: { params: Promise<{ topic: string }> }) {
  const { topic } = await params;
  const categories = topicToCategories(topic);

  const statusRes = await pool.query<SourceStatus>(
    `select source, last_success_at, last_count, state from source_status where source in ('rss','reddit') and category = any($1::text[])
     order by last_success_at asc nulls first`,
    [categories]
  );

  // 여러 주제가 합쳐진 "전체"에서는 소스별로 가장 최근에 성공한 카테고리를 대표로 표시 (asc 정렬이라 뒤에 올수록 최신 → 마지막 값이 남음)
  const statusBySource = Object.fromEntries(statusRes.rows.map((s) => [s.source, s]));

  return (
    <div>
      <Container title="RSS">
        <SourceStatusCard status={statusBySource.rss} />
      </Container>
      <Container title="Reddit">
        <SourceStatusCard status={statusBySource.reddit} />
      </Container>
    </div>
  );
}
