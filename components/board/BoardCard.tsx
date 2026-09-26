"use client";

import { useEffect, useState } from "react";
import type { Card } from "@/lib/board-data";
import { saveChoice, removeChoice, saveNote } from "@/app/board/actions";

// 후보별 선택, 우클릭 메뉴, 3안 입력과 언어 전환은 이 카드 안에서 처리한다.

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
  const [selected, setSelected] = useState<number | null>(null);
  const [menu, setMenu] = useState<number | null>(null);
  const [ideaOpen, setIdeaOpen] = useState(false);
  const saved = card.status === "saved";
  const body = stripSig(card.body);
  const ownIdea = card.selections.find((s) => s.choice === 2);
  const p = card.worth_parts;

  useEffect(() => {
    const closeOtherIdea = (event: Event) => {
      if ((event as CustomEvent<string>).detail !== card.id) setIdeaOpen(false);
    };
    window.addEventListener("board-idea-open", closeOtherIdea);
    return () => window.removeEventListener("board-idea-open", closeOtherIdea);
  }, [card.id]);

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
          <button type="button" className="idea-trigger" aria-expanded={ideaOpen} aria-controls={`idea-note-${card.id}`}
            onClick={() => {
              if (!ideaOpen) window.dispatchEvent(new CustomEvent("board-idea-open", { detail: card.id }));
              setIdeaOpen(!ideaOpen);
            }}>＋ 내 아이디어</button>
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
          <p className="rl" style={{ marginTop: 0 }}>발행할 콘텐츠 후보 <span className="sub2">— 각각 확정할 수 있어요</span></p>
          <div className="angles">
            {card.angles?.map((a, i) => (
              <div className="angle-wrap" key={i}>
                <button type="button" className={`angle${i === selected ? " on" : ""}${card.selections.some((s) => s.choice === i) ? " saved" : ""}`}
                  aria-pressed={i === selected}
                  onClick={() => { setSelected(i); setMenu(null); }}
                  onContextMenu={(event) => { event.preventDefault(); setSelected(i); setMenu(i); }}>
                  <span className="dot" aria-hidden="true" />
                  <span className="abody">
                    <span className="ako">{a.ko}</span>
                    <span className="aen">{a.en}</span>
                    <span className="ag">{a.guide}</span>
                    {card.selections.some((s) => s.choice === i) && <span className="saved-label">확정됨</span>}
                  </span>
                </button>
                {menu === i && <form action={async (data) => { await saveChoice(data); setSelected(null); setMenu(null); }} className="angle-menu">
                  <input type="hidden" name="id" value={card.id} />
                  <input type="hidden" name="choice" value={i} />
                  <button type="submit">이 후보 확정</button>
                </form>}
              </div>
            ))}
          </div>

          <div className="cart">
            <form action={async (data) => { await saveChoice(data); setSelected(null); setMenu(null); }}>
              <input type="hidden" name="id" value={card.id} />
              <input type="hidden" name="choice" value={selected ?? ""} />
              <button type="submit" className="confirm" disabled={selected === null}>
                {selected === null ? "확정할 후보를 선택하세요" : `${selected + 1}안 글감으로 확정`}
              </button>
            </form>
            {card.selections.length > 0 && <div className="saved-list">
              {card.selections.map((s) => <form action={removeChoice} key={s.choice}>
                <input type="hidden" name="id" value={card.id} />
                <input type="hidden" name="choice" value={s.choice} />
                <span>{s.choice + 1}안 확정됨</span>
                <button type="submit" aria-label={`${s.choice + 1}안 확정 해제`}>해제</button>
              </form>)}
            </div>}
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
      {ideaOpen && <aside className="idea-sticky" id={`idea-note-${card.id}`} role="region" aria-labelledby={`idea-title-${card.id}`}
        onKeyDown={(event) => { if (event.key === "Escape") setIdeaOpen(false); }}>
        <div className="idea-sticky-head"><h3 id={`idea-title-${card.id}`}>3안 · 내 아이디어</h3><button type="button" onClick={() => setIdeaOpen(false)} aria-label="메모 닫기">×</button></div>
        <p className="idea-sticky-source">{card.topic}</p>
        <p className="note">추천 1·2안과 별도로 글감에 저장됩니다.</p>
        <form action={async (data) => { await saveChoice(data); setIdeaOpen(false); setSelected(null); }}>
          <input type="hidden" name="id" value={card.id} />
          <input type="hidden" name="choice" value="2" />
          <label>제목<input name="title" required autoFocus maxLength={200} defaultValue={ownIdea?.title ?? ""} placeholder="내가 쓰고 싶은 콘텐츠 제목" /></label>
          <label>내용·작성 방향<textarea name="guide" rows={5} maxLength={5000} defaultValue={ownIdea?.guide ?? ""} placeholder="핵심 의견과 다룰 내용을 적어 주세요" /></label>
          <button type="submit" className="confirm">3안 글감으로 확정</button>
        </form>
      </aside>}
    </article>
  );
}
