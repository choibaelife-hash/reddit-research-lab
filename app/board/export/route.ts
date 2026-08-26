import { NextResponse } from "next/server";
import { getCards } from "@/lib/board-data";

// 확정한 글감을 마크다운 파일로 내려준다.
// 아티팩트 샌드박스는 다운로드를 막아서 복사 버튼으로 우회했었는데, 앱에서는 실제 파일로 받을 수 있다.
export async function GET() {
  const cards = (await getCards()).filter((c) => c.status === "saved");

  const out: string[] = [
    "# 이번 주 글감", "",
    `추출 ${new Date().toISOString().slice(0, 10)} · 출처: 레딧 4개 서브레딧`, "",
  ];

  cards.forEach((c, i) => {
    const a = c.angles?.[c.chosen_angle ?? 0] ?? c.angles?.[0];
    out.push("---", "", `## ${i + 1}. ${a?.ko ?? c.topic}`, "");
    if (a?.en) out.push(`**영문 제목** ${a.en}`, "");
    out.push(`**분류** ${c.area} · ${c.type} · 가치 ${c.worth}`);
    out.push(`**점수 분해** 순위 ${c.worth_parts?.rank ?? 0} · 질문 ${c.worth_parts?.question ?? 0} · 한국 ${c.worth_parts?.korea ?? 0} · 가산 ${c.worth_parts?.bonus ?? 0}`);
    out.push(`**출처** r/${c.sub} #${c.rank} — ${c.url}`, "");
    if (a?.guide) out.push("### 작성 가이드", a.guide, "");
    if (c.gap) out.push("### 왜 이 소재인가", c.gap, "");
    out.push("### 원글 요약", c.summary_ko, "");

    const d = c.detail ?? {};
    const rows: [string, string][] = [
      ["요구 조건", (d.asked ?? []).join(" · ")],
      ["댓글의 추천", (d.suggested ?? []).join(" · ")],
      ["리뷰 대상", d.subject ?? ""],
      ["평가", d.verdict ?? ""],
      ["주장", d.claim ?? ""],
      ["댓글의 반박", d.pushback ?? ""],
      ["공유된 루틴", (d.routine ?? []).join(" → ")],
    ];
    const filled = rows.filter(([, v]) => v);
    if (filled.length) {
      out.push("### 근거");
      filled.forEach(([k, v]) => out.push(`- **${k}** ${v}`));
      out.push("");
    }
    if (c.misconception?.has) {
      out.push("### 바로잡을 오해", `- 잘못 알고 있는 것: ${c.misconception.what}`,
               `- 실제로는: ${c.misconception.correction}`, "");
    }
    if (c.keywords?.length) out.push("### 키워드", c.keywords.join(", "), "");
    if (c.comments?.length) {
      out.push("### 인기 댓글");
      c.comments.forEach((x, j) => out.push(`${j + 1}. ${x.body_ko || x.body.slice(0, 180)}`));
      out.push("");
    }
    out.push("### 내 메모", c.note || "(없음)", "");
  });

  if (!cards.length) out.push("확정한 글감이 없습니다.");

  return new NextResponse(out.join("\n"), {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="glgam-${new Date().toISOString().slice(0, 10)}.md"`,
    },
  });
}
