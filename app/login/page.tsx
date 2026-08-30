import { LoginForm } from "./LoginForm";

export const metadata = { title: "로그인 — 소재 보드" };

export default async function LoginPage({
  searchParams,
}: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;

  return (
    <main className="loginwrap">
      <div className="loginbox">
        <p className="leyebrow">museofseoul</p>
        <h1>주간 레딧 소재 보드</h1>
        <p className="ldesc">
          영어권 레딧에서 매주 K-뷰티 화제를 모아 콘텐츠 소재로 바꿉니다.
        </p>
        <LoginForm next={next ?? "/board"} />
      </div>
    </main>
  );
}
