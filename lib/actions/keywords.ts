"use server";

import { pool } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { categoryToTopic } from "@/lib/topics";

// candidate -> observing: 사람이 "이건 지켜볼 가치 있다"고 확인한 시점을 기록
export async function promoteKeyword(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const category = String(formData.get("category") ?? "");
  const source = String(formData.get("source") ?? "");
  if (!id) return;
  await pool.query(
    `update keywords set status = 'observing', promoted_at = now() where id = $1 and status = 'candidate'`,
    [id]
  );
  revalidatePath(`/admin/${categoryToTopic(category)}/${source}`);
}
