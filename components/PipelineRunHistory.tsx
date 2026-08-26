export type PipelineRun = {
  id: string;
  run_type: string;
  started_at: string;
  finished_at: string | null;
  result_summary: string | null;
  error: string | null;
};

export function PipelineRunHistory({
  runs,
  runTypeLabel,
}: {
  runs: PipelineRun[];
  runTypeLabel: Record<string, string>;
}) {
  if (runs.length === 0) {
    return <p style={{ fontSize: 13, color: "#bbb" }}>아직 실행 이력이 없습니다.</p>;
  }
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
      <thead>
        <tr style={{ borderBottom: "1px solid #eee" }}>
          <th style={{ textAlign: "left", padding: "6px 4px", color: "#888", fontWeight: 500 }}>시각</th>
          <th style={{ textAlign: "left", padding: "6px 4px", color: "#888", fontWeight: 500 }}>작업</th>
          <th style={{ textAlign: "left", padding: "6px 4px", color: "#888", fontWeight: 500 }}>결과</th>
        </tr>
      </thead>
      <tbody>
        {runs.map((r) => (
          <tr key={r.id} style={{ borderBottom: "1px solid #f5f5f5" }}>
            <td style={{ padding: "7px 4px", color: "#999" }}>
              {new Date(r.started_at).toLocaleString("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
            </td>
            <td style={{ padding: "7px 4px" }}>{runTypeLabel[r.run_type] ?? r.run_type}</td>
            <td style={{ padding: "7px 4px" }}>
              {!r.finished_at ? (
                <span style={{ fontSize: 11, padding: "1px 8px", borderRadius: 999, background: "#f0f0f0", color: "#999" }}>진행중</span>
              ) : r.error ? (
                <span style={{ fontSize: 11, padding: "1px 8px", borderRadius: 999, background: "#fbe2e2", color: "#7a2020" }}>
                  실패 · {r.error}
                </span>
              ) : (
                <span style={{ fontSize: 11, padding: "1px 8px", borderRadius: 999, background: "#e8f0e6", color: "#2d4a28" }}>
                  성공 · {r.result_summary}
                </span>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
