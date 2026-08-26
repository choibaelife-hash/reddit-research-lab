import { redirect } from "next/navigation";

export default async function TopicIndex({ params }: { params: Promise<{ topic: string }> }) {
  const { topic } = await params;
  redirect(`/admin/${topic}/dashboard`);
}
