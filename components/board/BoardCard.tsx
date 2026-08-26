"use client";

import { useState } from "react";
import type { Card } from "@/lib/board-data";
import { toggleConfirm, chooseAngle, saveNote } from "@/app/board/actions";

// 클라이언트가 필요한 건 두 가지뿐이다: 한국어/영어 전환, 메모 입력.
// 확정·후보 선택은 form + Server Action이라 자바스크립트 없이도 동작한다.

function stripSig(b: string | null) {
  return (b ?? "").replace(/submitted by[\s\S]*$/, "").trim();
}

const DETAIL_ROWS: [string, string, string][] = [
  ["요구 조건", "asked", " · "],
  ["댓글의 추천", "suggested", " · "],
  ["공유된 루틴", "routine", " → "],
];
const DETAIL_TEXT: [string, string][] = [
  ["리뷰 대상", "subject"], ["평가", "verdict"], ["주장", "claim"], ["댓글의 반박", "pushback"],
];

export function BoardCard({ card }: { card: Card }) {
  const [lang, setLang] = useState<"ko" | "en">("ko");
  const [note, setNote] = useState(card.note ?? "");
  const saved = card.status === "saved";
  const body = stripSig(card.body);
  const chosen = card.chosen_angle ?? 0;
  const p = card.worth_parts;

  const detail: [string, string][] = [];
  for (const [k, key, j] of DETAIL_ROWS) {
    const v = card.detail?.[key];
    if (Array.isArray(v) && v.length) detail.push([k, v.join(j)]);
  }
  for (const [k, key] of DETAIL_TEXT) {
    const v = card.detail?.[key];
    if (v) detail.push([k, String(v)]);
  }

  return (
    <article className={`card${saved ? " done" : ""}`} id={`card-${card.id}`}>
      <header className="chead">
        <div className="cmeta">
          <span className="badge">{card.sub} #{card.rank}</span>
          <span className="badge soft">{card.area}</span>
          <span className="badge soft">{card.type}</span>
          <span className="worth">가치 {card.worth}</span>
        </div>
        <h3>{card.topic}</h3>
        {p && (
          <div className="parts" title="기본 100 + 가산 최대 30, 상한 100">
            <span>순위 <b>{p.rank}</b></span>
            <span>질문 <b>{p.question}</b></span>
            <span>한국 <b>{p.korea}</b></span>
            <span className="bon">댓글 <b>{p.comments}</b></span>
            <span className="bon">확산 <b>{p.spread}</b></span>
            <span className="bon">매거진 <b>{p.magazine}</b></span>
          </div>
        )}
      </header>

      <div className="cgrid">
        <div className="cleft">
          <div className="lhead">
            <span className="rl">읽기 · 근거</span>
            <span className="langbar">
              <button type="button" className={lang === "ko" ? "lang on" : "lang"} onClick={() => setLang("ko")}>한국어</button>
              <button type="button" className={lang === "en" ? "lang on" : "lang"} onClick={() => setLang("en")}>English</button>
            </span>
          </div>

          {lang === "ko" ? (
            <>
              <p className="rl">한 줄 요약</p>
              <p className="summary">{card.summary_ko}</p>
              {card.gap && (<><p className="rl">정보 격차</p><p className="gap">{card.gap}</p></>)}
              {card.misconception?.has && (
                <>
                  <p className="rl">바로잡을 오해</p>
                  <p className="gap"><b>{card.misconception.what}</b><br />→ {card.misconception.correction}</p>
                </>
              )}
              {detail.length > 0 && (
                <>
                  <p className="rl">유형별 추출</p>
                  <dl className="dls">
                    {detail.map(([k, v]) => (
                      <div className="dl" key={k}><dt>{k}</dt><dd>{v}</dd></div>
                    ))}
                  </dl>
                </>
              )}
              {card.keywords.length > 0 && (
                <>
                  <p className="rl">키워드 <span className="sub2">— 한국어 / English</span></p>
                  <div className="tags">
                    {card.keywords.map((k) => <span className="tchip" key={k}>{k}</span>)}
                  </div>
                </>
              )}
              <p className="rl">댓글 요약</p>
              {card.comments.length ? (
                <ol className="cmt">
                  {card.comments.map((c) => <li key={c.rank}>{c.body_ko || c.body.slice(0, 170)}</li>)}
                </ol>
              ) : <p className="note">가져온 댓글이 없습니다.</p>}
            </>
          ) : (
            <>
              <p className="rl">Original post</p>
              <p className="orig-link">
                <a href={card.url} target="_blank" rel="noopener noreferrer">{card.title} ↗</a>
              </p>
              <div className="mono">{body || "본문 없음 — 이미지 글"}</div>
              <p className="rl">Top comments</p>
              {card.comments.length ? (
                <ol className="cmt">
                  {card.comments.map((c) => (
                    <li key={c.rank}><span className="u">{c.author}</span> {c.body.slice(0, 280)}</li>
                  ))}
                </ol>
              ) : <p className="note">No comments.</p>}
            </>
          )}
        </div>

        <div className="cright">
          <p className="rl" style={{ marginTop: 0 }}>발행할 콘텐츠 후보 <span className="sub2">— 하나 고르세요</span></p>
          <div className="angles">
            {card.angles?.map((a, i) => (
              <form action={chooseAngle} key={i}>
                <input type="hidden" name="id" value={card.id} />
                <input type="hidden" name="idx" value={i} />
                <button type="submit" className={`angle${i === chosen ? " on" : ""}`}>
                  <span className="dot" aria-hidden="true" />
                  <span className="abody">
                    <span className="ako">{a.ko}</span>
                    <span className="aen">{a.en}</span>
                    <span className="ag">{a.guide}</span>
                  </span>
                </button>
              </form>
            ))}
          </div>

          <div className="cart">
            <form action={toggleConfirm}>
              <input type="hidden" name="id" value={card.id} />
              <button type="submit" className={`confirm${saved ? " on" : ""}`}>
                {saved ? "확정됨 — 해제하려면 누르세요" : "글감으로 확정"}
              </button>
            </form>
            <form action={saveNote} className="memoform">
              <input type="hidden" name="id" value={card.id} />
              <textarea
                name="note" className="memo" rows={3}
                value={note} onChange={(e) => setNote(e.target.value)}
                placeholder="메모 — 어떻게 쓸지, 뭘 더 확인할지"
              />
              <button type="submit" className="memosave">메모 저장</button>
            </form>
          </div>
        </div>
      </div>
    </article>
  );
}
