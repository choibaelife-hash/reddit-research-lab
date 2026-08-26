import { ALL_SECTION_TOPICS, TopicSection } from "@/components/TopicSection";

export default async function GooglePage({ params }: { params: Promise<{ topic: string }> }) {
  const { topic } = await params;

  return (
    <div>
      <h2 className="font-serif" style={{ fontSize: 18, marginBottom: 8 }}>
        Google
      </h2>
      {topic === "all" ? (
        ALL_SECTION_TOPICS.map((s) => (
          <TopicSection key={s.topic} topic={s.topic}>
            <p style={{ fontSize: 13, color: "#999" }}>준비 중입니다.</p>
          </TopicSection>
        ))
      ) : (
        <p style={{ fontSize: 13, color: "#8a8a8a" }}>준비 중입니다.</p>
      )}
    </div>
  );
}
