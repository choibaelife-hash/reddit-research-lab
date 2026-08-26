"use server";

import { pool } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { collectRss } from "@/lib/collectors/rss";
import { collectReddit } from "@/lib/collectors/reddit";
import { TOPIC_SLUGS, categoryToTopic } from "@/lib/topics";

export async function addRule(formData: FormData) {
  const category = String(formData.get("category") ?? "");
  const source = String(formData.get("source") ?? "");
  const value = String(formData.get("value") ?? "").trim();
  if (!category || !source || !value) return;

  await pool.query(
    `insert into collection_rules (category, source, value, enabled) values ($1, $2, $3, true)
     on conflict (category, source, value) do update set enabled = true`,
    [category, source, value]
  );
  revalidatePath(`/admin/${categoryToTopic(category)}/${source}`);
}

export async function deleteRule(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const category = String(formData.get("category") ?? "");
  const source = String(formData.get("source") ?? "");
  if (!id) return;
  await pool.query(`delete from collection_rules where id = $1`, [id]);
  revalidatePath(`/admin/${categoryToTopic(category)}/${source}`);
}

export async function toggleRule(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const category = String(formData.get("category") ?? "");
  const source = String(formData.get("source") ?? "");
  const enabled = formData.get("enabled") === "true";
  if (!id) return;
  await pool.query(`update collection_rules set enabled = $2 where id = $1`, [id, !enabled]);
  revalidatePath(`/admin/${categoryToTopic(category)}/${source}`);
}

// ponytail: 수집기가 카테고리 구분 없이 전체 규칙을 돌기 때문에 모든 주제 탭 전부 재검증
export async function runRss() {
  await collectRss();
  for (const t of TOPIC_SLUGS) {
    revalidatePath(`/admin/${t}/rss`);
    revalidatePath(`/admin/${t}/history`);
  }
}

export async function runReddit() {
  await collectReddit();
  for (const t of TOPIC_SLUGS) {
    revalidatePath(`/admin/${t}/reddit`);
    revalidatePath(`/admin/${t}/history`);
  }
}
