import Link from "next/link";
import { ViewTransition } from "react";
import { TopicSwitcher } from "@/components/TopicSwitcher";

const NAV_ITEMS = [
  {
    slug: "dashboard",
    label: "Dashboard",
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="3" y="3" width="7" height="7" rx="1.5" />
        <rect x="14" y="3" width="7" height="7" rx="1.5" />
        <rect x="3" y="14" width="7" height="7" rx="1.5" />
        <rect x="14" y="14" width="7" height="7" rx="1.5" />
      </svg>
    ),
  },
  {
    slug: "rss",
    label: "RSS",
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="5" cy="19" r="1.5" fill="currentColor" stroke="none" />
        <path d="M4 4a16 16 0 0 1 16 16" />
        <path d="M4 11a9 9 0 0 1 9 9" />
      </svg>
    ),
  },
  {
    slug: "reddit",
    label: "Reddit",
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="14" r="7" />
        <circle cx="9" cy="14" r="1" fill="currentColor" stroke="none" />
        <circle cx="15" cy="14" r="1" fill="currentColor" stroke="none" />
        <path d="M9 17c1 1 5 1 6 0" />
        <path d="M12 7V3" />
        <circle cx="12" cy="3" r="1.2" fill="currentColor" stroke="none" />
      </svg>
    ),
  },
  {
    slug: "google",
    label: "Google",
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 12h5.5c0 3-2.2 5-5.5 5a5 5 0 1 1 3.5-8.6" />
      </svg>
    ),
  },
  {
    slug: "history",
    label: "이력",
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 3" />
      </svg>
    ),
  },
];

// topic이 없으면(홈 화면 등) 좌측 네비는 기본 주제(k-beauty)로 링크를 건다 — 홈은 아직 특정 주제에 속하지 않아서
export function DashboardShell({ topic, children }: { topic: string; children: React.ReactNode }) {
  return (
    <>
      <TopicSwitcher />
      <div style={{ maxWidth: 1400, margin: "0 auto", padding: "1rem 1.5rem 2rem" }}>
        <Link href="/admin/all/dashboard" style={{ textDecoration: "none", color: "inherit" }}>
          <h1 className="font-serif" style={{ fontSize: 28, marginBottom: 24 }}>
            Contents Dashboard
          </h1>
        </Link>
        <div style={{ display: "flex", gap: 32, alignItems: "flex-start" }}>
          <ViewTransition key={topic} enter="nav-flyin" default="none">
            <nav
              style={{
                width: 160,
                flexShrink: 0,
                display: "flex",
                flexDirection: "column",
                gap: 8,
                position: "sticky",
                top: 20,
                alignSelf: "flex-start",
              }}
            >
              {NAV_ITEMS.map((item) => (
                <Link
                  key={item.slug}
                  href={`/admin/${topic}/${item.slug}`}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    fontSize: 14,
                    padding: "10px 12px",
                    borderRadius: 8,
                    background: "#ede6f5",
                    color: "#37263a",
                    textDecoration: "none",
                  }}
                >
                  {item.icon}
                  {item.label}
                </Link>
              ))}
            </nav>
          </ViewTransition>
          <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
        </div>
      </div>
    </>
  );
}
