import { topicLabel } from "@/lib/topics";

const PLATFORMS = ["RSS", "Reddit", "Google"];

function PlatformCard({ label }: { label: string }) {
  return (
    <section style={{ border: "1px solid #eee", borderRadius: 8, padding: "1.25rem" }}>
      <h3 className="font-serif" style={{ fontSize: 15, marginBottom: 8 }}>
        {label}
      </h3>
      <p style={{ fontSize: 13, color: "#8a8a8a" }}>준비 중입니다.</p>
    </section>
  );
}

export default async function TopicDashboardPage({ params }: { params: Promise<{ topic: string }> }) {
  const { topic } = await params;

  if (topic === "all") {
    return (
      <div>
        <h2 className="font-serif" style={{ fontSize: 18, marginBottom: 8 }}>
          {topicLabel(topic)} Dashboard
        </h2>
        <p style={{ fontSize: 13, color: "#8a8a8a" }}>준비 중입니다. RSS·Reddit 종합 화면이 곧 여기에 생깁니다.</p>
      </div>
    );
  }

  return (
    <div>
      <h2 className="font-serif" style={{ fontSize: 18, marginBottom: 4 }}>
        {topicLabel(topic)} Dashboard
      </h2>
      {topic === "k-beauty" && (
        <p style={{ fontSize: 12.5, color: "#999", marginBottom: 20 }}>
          매주 2회 콘텐츠 수집(토요일 오전 트리거) 결과를 모아 일요일 새벽에 갱신됩니다.
        </p>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 16, marginTop: topic === "k-beauty" ? 0 : 20 }}>
        {PLATFORMS.map((p) => (
          <PlatformCard key={p} label={p} />
        ))}
      </div>
    </div>
  );
}
