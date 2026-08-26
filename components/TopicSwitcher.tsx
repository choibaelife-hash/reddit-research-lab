"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { TOPICS } from "@/lib/topics";

export function TopicSwitcher() {
  const pathname = usePathname();
  const segments = pathname.split("/");
  const currentTopic = segments[2];
  // /admin/{topic}/{platform}/... 에서 platform 이하를 그대로 유지한 채 topic만 바꾼다
  const rest = segments.slice(3).join("/");

  return (
    <nav style={{ display: "flex", justifyContent: "flex-end", gap: 8, padding: "16px 16px 0" }}>
      {TOPICS.map((t) => {
        const active = t.topic === currentTopic;
        return (
          <Link
            key={t.topic}
            href={`/admin/${t.topic}${rest ? `/${rest}` : ""}`}
            style={{
              fontSize: 12,
              padding: "6px 12px",
              borderRadius: 2,
              background: active ? "var(--color-plum)" : "#fff",
              color: active ? "#fff" : "var(--color-plum)",
              textDecoration: "none",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
            }}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
