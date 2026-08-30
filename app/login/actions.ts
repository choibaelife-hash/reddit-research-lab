"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { pool } from "@/lib/db";
import { verifyPassword } from "@/lib/password.mjs";
import { SESSION_COOKIE, WS_COOKIE, signSession } from "@/lib/session.mjs";

export async function login(_prev: unknown, formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const next = String(formData.get("next") ?? "/board");

  const { rows } = await pool.query<{ id: string; password_hash: string }>(
    `select id, password_hash from users where email = $1`,
    [email]
  );
  const user = rows[0];

  // 이메일이 없을 때와 비밀번호가 틀릴 때의 메시지를 같게 둔다.
  // 다르게 하면 "이 이메일은 가입돼 있다"를 알려주는 셈이 된다.
  if (!user || !(await verifyPassword(password, user.password_hash))) {
    return { error: "이메일 또는 비밀번호가 맞지 않습니다." };
  }

  const c = await cookies();
  c.set(SESSION_COOKIE, await signSession(user.id), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 60, // 60일
  });
  // 계정을 바꿔 로그인했는데 이전 사람의 워크스페이스가 남아 있으면 안 된다.
  c.delete(WS_COOKIE);

  redirect(next.startsWith("/") ? next : "/board");
}

export async function logout() {
  const c = await cookies();
  c.delete(SESSION_COOKIE);
  c.delete(WS_COOKIE);
  redirect("/login");
}
