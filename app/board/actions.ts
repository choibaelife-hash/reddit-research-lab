"use server";

import { pool } from "@/lib/db";
import { revalidatePath } from "next/cache";

// 정적 HTML 시절엔 확정·메모가 브라우저 localStorage에만 남았다.
// 이제 idea_cards 테이블에 실제로 저장한다 — 다른 기기에서 열어도 그대로 있고, 나중에 자동화가 읽을 수 있다.

export async function toggleConfirm(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await pool.query(
    `update idea_cards
        set status = case when status = 'saved' then 'candidate' else 'saved' end,
            saved_at = case when status = 'saved' then null else now() end,
            updated_at = now()
      where mention_id = $1`,
    [id]
  );
  revalidatePath("/board");
}

export async function chooseAngle(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const idx = Number(formData.get("idx") ?? 0);
  if (!id) return;
  await pool.query(
    `update idea_cards set chosen_angle = $2, updated_at = now() where mention_id = $1`,
    [id, idx]
  );
  revalidatePath("/board");
}

export async function saveNote(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const note = String(formData.get("note") ?? "");
  if (!id) return;
  await pool.query(
    `update idea_cards set note = $2, updated_at = now() where mention_id = $1`,
    [id, note || null]
  );
  revalidatePath("/board");
}
