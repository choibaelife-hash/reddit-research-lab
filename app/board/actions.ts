"use server";

import { pool } from "@/lib/db";
import { refresh, updateTag } from "next/cache";
import { cardCacheTag, countCacheTag } from "@/lib/board-cache";
import { currentWorkspace } from "@/lib/workspace";

// 정적 HTML 시절엔 확정·메모가 브라우저 localStorage에만 남았다.
// 이제 idea_cards 테이블에 실제로 저장한다 — 다른 기기에서 열어도 그대로 있고, 나중에 자동화가 읽을 수 있다.

async function ownedCard(id: string) {
  const workspace = await currentWorkspace();
  if (!workspace) return null;
  const { rows } = await pool.query<{ run_id: string; angles: { ko: string; en?: string; guide?: string }[] }>(
    `select c.run_id::text, c.angles from idea_cards c
       join runs r on r.id = c.run_id
      where c.mention_id = $1 and r.workspace_id = $2`,
    [id, workspace.id]
  );
  return rows[0] ?? null;
}

function invalidate(runId: string, counts = false) {
  updateTag(cardCacheTag(runId));
  if (counts) updateTag(countCacheTag(runId));
  refresh();
}

export async function saveChoice(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const rawChoice = formData.get("choice");
  const choice = Number(rawChoice);
  if (!id || rawChoice === null || rawChoice === "" || !Number.isInteger(choice) || choice < 0 || choice > 2) return;
  const card = await ownedCard(id);
  if (!card) return;

  const title = choice === 2 ? String(formData.get("title") ?? "").trim() : card.angles?.[choice]?.ko?.trim();
  const titleEn = choice === 2 ? null : card.angles?.[choice]?.en ?? null;
  const guide = choice === 2 ? String(formData.get("guide") ?? "").trim() : card.angles?.[choice]?.guide ?? null;
  if (!title || title.length > 200 || (guide?.length ?? 0) > 5000) return;

  await pool.query(
    `insert into idea_selections (mention_id, choice, title, title_en, guide)
     values ($1, $2, $3, $4, $5)
     on conflict (mention_id, choice) do update set
       title = excluded.title, title_en = excluded.title_en,
       guide = excluded.guide, saved_at = now()`,
    [id, choice, title, titleEn, guide]
  );
  await pool.query(
    `update idea_cards set status = 'saved', saved_at = coalesce(saved_at, now()),
       chosen_angle = case when $2::smallint < 2 then $2 else chosen_angle end,
       updated_at = now() where mention_id = $1`,
    [id, choice]
  );
  invalidate(card.run_id, true);
}

export async function removeChoice(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const rawChoice = formData.get("choice");
  const choice = Number(rawChoice);
  if (!id || rawChoice === null || rawChoice === "" || !Number.isInteger(choice) || choice < 0 || choice > 2) return;
  const card = await ownedCard(id);
  if (!card) return;
  await pool.query(`delete from idea_selections where mention_id = $1 and choice = $2`, [id, choice]);
  await pool.query(
    `update idea_cards set
       status = case when exists (select 1 from idea_selections where mention_id = $1) then 'saved' else 'candidate' end,
       saved_at = case when exists (select 1 from idea_selections where mention_id = $1) then saved_at else null end,
       updated_at = now() where mention_id = $1`,
    [id]
  );
  invalidate(card.run_id, true);
}

export async function saveNote(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const note = String(formData.get("note") ?? "");
  const card = await ownedCard(id);
  if (!card || note.length > 5000) return;
  await pool.query(
    `update idea_cards set note = $2, updated_at = now() where mention_id = $1`,
    [id, note || null]
  );
  invalidate(card.run_id);
}
