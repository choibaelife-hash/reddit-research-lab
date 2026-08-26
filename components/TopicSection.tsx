import { topicLabel } from "@/lib/topics";

// "전체"에서 콘텐츠를 주제별로 나눠 보여줄 때 쓰는 순서·배경색 — 화면마다 재사용
export const ALL_SECTION_TOPICS: { topic: string; bg: string }[] = [
  { topic: "k-beauty", bg: "#efe7da" },
  { topic: "stay", bg: "#e3eef0" },
  { topic: "where-to-go", bg: "#ede6f5" },
];

export function TopicSection({ topic, children }: { topic: string; children: React.ReactNode }) {
  const bg = ALL_SECTION_TOPICS.find((s) => s.topic === topic)?.bg ?? "#f5f5f5";
  return (
    <div style={{ background: bg, borderRadius: 8, padding: "1rem", marginBottom: 12 }}>
      <h3 className="font-serif" style={{ fontSize: 13, marginBottom: 8, color: "var(--color-plum)" }}>
        {topicLabel(topic)}
      </h3>
      {children}
    </div>
  );
}
