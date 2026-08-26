"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE, tokenFor } from "@/proxy";

export async function login(_prev: unknown, formData: FormData) {
  const password = String(formData.get("password") ?? "");
  const next = String(formData.get("next") ?? "/board");
  const expected = process.env.BOARD_PASSWORD;

  if (!expected) redirect(next);
  if (password !== expected) return { error: "비밀번호가 맞지 않습니다." };

  (await cookies()).set(COOKIE, await tokenFor(expected), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 60, // 60일
  });
  redirect(next.startsWith("/") ? next : "/board");
}

export async function logout() {
  (await cookies()).delete(COOKIE);
  redirect("/login");
}
