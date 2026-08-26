import { notFound } from "next/navigation";
import { DashboardShell } from "@/components/DashboardShell";
import { TOPIC_SLUGS } from "@/lib/topics";

export default async function TopicLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ topic: string }>;
}) {
  const { topic } = await params;
  if (!TOPIC_SLUGS.includes(topic) && topic !== "all") {
    notFound();
  }

  return <DashboardShell topic={topic}>{children}</DashboardShell>;
}
