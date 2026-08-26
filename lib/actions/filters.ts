"use server";

import { pool } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { TOPIC_SLUGS } from "@/lib/topics";

export async function addExclude(formData: FormData) {
  const value = String(formData.get("value") ?? "").trim();
  if (!value) return;
  await pool.query(
    `insert into title_excludes (value) values ($1) on conflict (value) do update set enabled = true`,
    [value]
  );
  for (const t of TOPIC_SLUGS) revalidatePath(`/admin/${t}/reddit`);
}

export async function deleteExclude(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await pool.query(`delete from title_excludes where id = $1`, [id]);
  for (const t of TOPIC_SLUGS) revalidatePath(`/admin/${t}/reddit`);
}

export async function toggleExclude(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const enabled = formData.get("enabled") === "true";
  if (!id) return;
  await pool.query(`update title_excludes set enabled = $2 where id = $1`, [id, !enabled]);
  for (const t of TOPIC_SLUGS) revalidatePath(`/admin/${t}/reddit`);
}
