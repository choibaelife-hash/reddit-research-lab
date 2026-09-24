"use server";

import { pool } from "@/lib/db";
import { refresh, updateTag } from "next/cache";
import { cardCacheTag, countCacheTag } from "@/lib/board-cache";

// 정적 HTML 시절엔 확정·메모가 브라우저 localStorage에만 남았다.
// 이제 idea_cards 테이블에 실제로 저장한다 — 다른 기기에서 열어도 그대로 있고, 나중에 자동화가 읽을 수 있다.

export async function toggleConfirm(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const { rows } = await pool.query<{ run_id: string | null }>(
    `update idea_cards
        set status = case when status = 'saved' then 'candidate' else 'saved' end,
            saved_at = case when status = 'saved' then null else now() end,
            updated_at = now()
      where mention_id = $1 returning run_id::text`,
    [id]
  );
  for (const row of rows) if (row.run_id) {
    updateTag(cardCacheTag(row.run_id));
    updateTag(countCacheTag(row.run_id));
  }
  refresh();
}

export async function chooseAngle(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const idx = Number(formData.get("idx") ?? 0);
  if (!id) return;
  const { rows } = await pool.query<{ run_id: string | null }>(
    `update idea_cards set chosen_angle = $2, updated_at = now() where mention_id = $1 returning run_id::text`,
    [id, idx]
  );
  for (const row of rows) if (row.run_id) updateTag(cardCacheTag(row.run_id));
  refresh();
}

export async function saveNote(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const note = String(formData.get("note") ?? "");
  if (!id) return;
  const { rows } = await pool.query<{ run_id: string | null }>(
    `update idea_cards set note = $2, updated_at = now() where mention_id = $1 returning run_id::text`,
    [id, note || null]
  );
  for (const row of rows) if (row.run_id) updateTag(cardCacheTag(row.run_id));
  refresh();
}
