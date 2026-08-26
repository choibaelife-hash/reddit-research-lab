// URL에 쓰는 주제 slug와 DB의 category 값이 다르다(예: URL은 k-beauty, DB는 products) — 여기서 한 곳에서만 매핑한다.
export const TOPICS = [
  { topic: "k-beauty", category: "products", label: "K-beauty" },
  { topic: "stay", category: "stay", label: "Stay" },
  { topic: "where-to-go", category: "where-to-go", label: "Where to go" },
] as const;

export const TOPIC_SLUGS: string[] = TOPICS.map((t) => t.topic);

export function topicToCategory(topic: string): string {
  return TOPICS.find((t) => t.topic === topic)?.category ?? topic;
}

// "all"(전체 통합)이면 모든 주제의 category를 반환 — 홈 대시보드에서 주제별 데이터를 합쳐 보여줄 때 씀
export function topicToCategories(topic: string): string[] {
  return topic === "all" ? TOPICS.map((t) => t.category) : [topicToCategory(topic)];
}

export function categoryToTopic(category: string): string {
  return TOPICS.find((t) => t.category === category)?.topic ?? category;
}

export function topicLabel(topic: string): string {
  if (topic === "all") return "전체";
  return TOPICS.find((t) => t.topic === topic)?.label ?? topic;
}

export function categoryLabel(category: string): string {
  return TOPICS.find((t) => t.category === category)?.label ?? category;
}
