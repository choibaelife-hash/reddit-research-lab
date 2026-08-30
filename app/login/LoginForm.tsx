"use client";

import { useActionState } from "react";
import { login } from "./actions";

export function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState(login, null as { error?: string } | null);

  return (
    <form action={action} className="lform">
      <input type="hidden" name="next" value={next} />
      <label className="llabel" htmlFor="email">이메일</label>
      <input
        id="email" name="email" type="email" autoFocus required
        className="linput" placeholder="you@example.com"
        autoComplete="username"
      />
      <label className="llabel" htmlFor="pw">비밀번호</label>
      <input
        id="pw" name="password" type="password" required
        className="linput" placeholder="비밀번호를 입력하세요"
        autoComplete="current-password"
      />
      {state?.error && <p className="lerror">{state.error}</p>}
      <button type="submit" className="lbtn" disabled={pending}>
        {pending ? "확인 중…" : "들어가기"}
      </button>
    </form>
  );
}
