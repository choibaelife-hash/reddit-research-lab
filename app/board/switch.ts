"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { WS_COOKIE } from "@/lib/session.mjs";
import { myWorkspaces } from "@/lib/workspace";

/**
 * 보고 있는 워크스페이스를 바꾼다.
 * 내 것이 아닌 아이디가 오면 무시한다 — 폼 값은 사용자가 고칠 수 있다.
 */
export async function switchWorkspace(formData: FormData) {
  const id = String(formData.get("ws") ?? "");
  const mine = await myWorkspaces();
  if (!mine.some((w) => w.id === id)) redirect("/board");

  (await cookies()).set(WS_COOKIE, id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  redirect("/board");
}
