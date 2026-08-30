"use server";

import { revalidatePath } from "next/cache";
import { pool } from "@/lib/db";
import { hashPassword, verifyPassword } from "@/lib/password.mjs";
import { currentUserId, myWorkspaces, me, PLANS } from "@/lib/workspace";

export async function addWorkspace(formData: FormData) {
  const uid = await currentUserId();
  const name = String(formData.get("name") ?? "").trim();
  if (!uid || !name) return;

  // 요금제 한도를 서버에서 막는다. 화면에서 버튼을 숨기는 것만으로는
  // 폼을 직접 보내면 그만이라 한도가 지켜지지 않는다.
  const who = await me();
  const limit = PLANS[who?.plan ?? "pro"]?.workspaces ?? 1;
  if ((await myWorkspaces()).length >= limit) return;

  await pool.query(`insert into workspaces (user_id, name) values ($1, $2)`, [uid, name]);
  revalidatePath("/mypage");
}

// where에 user_id를 반드시 넣는다. 빠지면 폼 값만 바꿔서 남의 워크스페이스 이름을 고칠 수 있다.
export async function renameWorkspace(formData: FormData) {
  const uid = await currentUserId();
  const id = String(formData.get("id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  if (!uid || !id || !name) return;
  await pool.query(`update workspaces set name = $3 where id = $1 and user_id = $2`, [id, uid, name]);
  revalidatePath("/mypage");
}

export async function savePerspective(formData: FormData) {
  const uid = await currentUserId();
  const id = String(formData.get("id") ?? "");
  const text = String(formData.get("perspective") ?? "").trim();
  if (!uid || !id) return;
  await pool.query(
    `update workspaces set perspective = $3 where id = $1 and user_id = $2`,
    [id, uid, text || null]
  );
  revalidatePath("/mypage");
}

export async function changePassword(_prev: unknown, formData: FormData) {
  const uid = await currentUserId();
  const now = String(formData.get("current") ?? "");
  const next = String(formData.get("next") ?? "");
  if (!uid) return { error: "로그인이 필요합니다." };
  if (next.length < 8) return { error: "새 비밀번호는 8자 이상이어야 합니다." };

  const { rows } = await pool.query<{ password_hash: string }>(
    `select password_hash from users where id = $1`, [uid]
  );
  if (!rows[0] || !(await verifyPassword(now, rows[0].password_hash))) {
    return { error: "지금 비밀번호가 맞지 않습니다." };
  }
  await pool.query(`update users set password_hash = $2 where id = $1`, [uid, await hashPassword(next)]);
  return { ok: "비밀번호를 바꿨습니다." };
}
