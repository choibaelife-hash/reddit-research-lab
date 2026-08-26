import Link from "next/link";
import { pool } from "@/lib/db";
import { addRule, deleteRule, toggleRule, runReddit } from "@/lib/actions/rules";
import { promoteKeyword } from "@/lib/actions/keywords";
import { addExclude, deleteExclude, toggleExclude } from "@/lib/actions/filters";
import { topicToCategories, topicLabel, categoryToTopic } from "@/lib/topics";
import { ALL_SECTION_TOPICS, TopicSection } from "@/components/TopicSection";

type KeywordRow = {
  id: string;
  label: string;
  status: string;
  category: string;
  first_seen_at: string;
  mention_count: number;
  sample_title: string | null;
  sample_url: string | null;
  sample_raw: { rank?: number | null; period?: string | null; subreddit?: string | null } | null;
  last_mention_at: string;
};

type Rule = {
  id: string;
  category: string;
  source: string;
  value: string;
  enabled: boolean;
};

type SourceStatus = {
  last_success_at: string | null;
  last_count: number | null;
  state: string;
};

type ExcludeTerm = {
  id: string;
  value: string;
  enabled: boolean;
};

const TITLE_TAG_CLASSIFY: Record<string, "수요형" | "정보형"> = {
  "routine help": "수요형",
  "product question": "수요형",
  "product request": "수요형",
  acne: "수요형",
  misc: "수요형",
  "sun care": "수요형",
};

function classifyTitle(title: string): "수요형" | "정보형" | null {
  const bracket = title.match(/\[([^\]]+)\]/);
  if (bracket) {
    const tag = bracket[1].toLowerCase();
    for (const key in TITLE_TAG_CLASSIFY) {
      if (tag.includes(key)) return TITLE_TAG_CLASSIFY[key];
    }
  }
  const lower = title.toLowerCase();
  if (lower.startsWith("review") || lower.startsWith("psa")) return "정보형";
  return null;
}

// 레딧 RSS는 업보트 수를 주지 않는다. 대신 top 정렬의 순위(1=최상위)가 화제성 신호다.
function rankOf(raw: KeywordRow["sample_raw"]) {
  return raw?.rank ?? Number.MAX_SAFE_INTEGER;
}

function buildHref(topic: string, params: { sort?: string; subreddit?: string }) {
  const sp = new URLSearchParams();
  if (params.sort) sp.set("sort", params.sort);
  if (params.subreddit) sp.set("subreddit", params.subreddit);
  const qs = sp.toString();
  return `/admin/${topic}/reddit${qs ? `?${qs}` : ""}`;
}

function daysAgo(iso: string) {
  const diffMs = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  return days <= 0 ? "오늘" : `${days}일 전`;
}

function timeAgo(iso: string | null) {
  if (!iso) return "아직 없음";
  const diffMin = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (diffMin < 60) return `${diffMin}분 전`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH}시간 전`;
  return `${Math.floor(diffH / 24)}일 전`;
}

function KeywordTable({ rows }: { rows: KeywordRow[] }) {
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
      <thead>
        <tr style={{ borderBottom: "1px solid #eee" }}>
          <th style={{ textAlign: "left", padding: "8px 4px", color: "#8a8a8a", fontWeight: 500 }}>키워드</th>
          <th style={{ textAlign: "left", padding: "8px 4px", color: "#8a8a8a", fontWeight: 500 }}>최근 언급 제목</th>
          <th style={{ textAlign: "right", padding: "8px 4px", color: "#8a8a8a", fontWeight: 500 }}>언급수</th>
          <th style={{ textAlign: "left", padding: "8px 4px", color: "#8a8a8a", fontWeight: 500 }}>상태</th>
          <th style={{ textAlign: "right", padding: "8px 4px", color: "#8a8a8a", fontWeight: 500 }}>최초 발견</th>
          <th style={{ padding: "8px 4px" }}></th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const tag = row.sample_title ? classifyTitle(row.sample_title) : null;
          return (
            <tr key={row.id} style={{ borderBottom: "1px solid #f5f5f5" }}>
              <td className="font-serif" style={{ padding: "8px 4px", fontWeight: 600 }}>
                {row.label}
                {tag && (
                  <span
                    style={{
                      marginLeft: 6,
                      fontSize: 10,
                      fontWeight: 400,
                      padding: "1px 6px",
                      borderRadius: 999,
                      background: tag === "수요형" ? "#e8f0e6" : "#eee6f0",
                      color: "#666",
                    }}
                  >
                    {tag}
                  </span>
                )}
              </td>
              <td style={{ padding: "8px 4px", color: "#666", maxWidth: 280 }}>
                {row.sample_url ? (
                  <a href={row.sample_url} target="_blank" rel="noreferrer" style={{ color: "var(--color-mauve)" }}>
                    {row.sample_title}
                  </a>
                ) : (
                  row.sample_title
                )}
              </td>
              <td style={{ padding: "8px 4px", textAlign: "right" }}>{row.mention_count}</td>
              <td style={{ padding: "8px 4px" }}>
                <span
                  style={{ fontSize: 11, padding: "2px 8px", borderRadius: 999, background: "var(--color-cream)", color: "var(--color-plum)" }}
                >
                  {row.status}
                </span>
              </td>
              <td style={{ padding: "8px 4px", textAlign: "right", color: "#999" }}>{daysAgo(row.first_seen_at)}</td>
              <td style={{ padding: "8px 4px", textAlign: "right" }}>
                {row.status === "candidate" ? (
                  <form action={promoteKeyword}>
                    <input type="hidden" name="id" value={row.id} />
                    <input type="hidden" name="category" value={row.category} />
                    <input type="hidden" name="source" value="reddit" />
                    <button
                      type="submit"
                      style={{ fontSize: 11, padding: "4px 10px", borderRadius: 2, border: "1px solid var(--color-mauve)", background: "transparent", color: "var(--color-mauve)" }}
                    >
                      담기
                    </button>
                  </form>
                ) : (
                  <span style={{ fontSize: 11, color: "#bbb" }}>담김</span>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export default async function RedditPage({
  params,
  searchParams,
}: {
  params: Promise<{ topic: string }>;
  searchParams: Promise<{ sort?: string; subreddit?: string }>;
}) {
  const { topic } = await params;
  const categories = topicToCategories(topic);
  const isAll = topic === "all";
  const { sort, subreddit } = await searchParams;

  const [rowsRes, rulesRes, statusRes, excludesRes] = await Promise.all([
    pool.query<KeywordRow>(
      `select k.id, k.label, k.status, k.category, k.first_seen_at,
              count(m.id)::int as mention_count,
              (array_agg(m.title order by m.occurred_at desc))[1] as sample_title,
              (array_agg(m.url order by m.occurred_at desc))[1] as sample_url,
              (array_agg(m.raw order by m.occurred_at desc))[1] as sample_raw,
              max(m.occurred_at) as last_mention_at
       from keywords k
       join mentions m on m.keyword_id = k.id and m.source = 'reddit'
       where k.category = any($1::text[]) and k.status != 'archived'
       group by k.id
       order by last_mention_at desc
       limit 50`,
      [categories]
    ),
    pool.query<Rule>(
      `select id, category, source, value, enabled from collection_rules where source = 'reddit' and category = any($1::text[]) order by value`,
      [categories]
    ),
    pool.query<SourceStatus>(
      `select last_success_at, last_count, state from source_status where source = 'reddit' and category = any($1::text[])`,
      [categories]
    ),
    pool.query<ExcludeTerm>(`select id, value, enabled from title_excludes order by value`),
  ]);

  const activeExcludes = excludesRes.rows.filter((e) => e.enabled).map((e) => e.value.toLowerCase());
  const isExcludedTitle = (title: string | null) =>
    !!title && activeExcludes.some((term) => title.toLowerCase().includes(term));

  let rows = rowsRes.rows.filter((r) => !isExcludedTitle(r.sample_title));
  const excludedCount = rowsRes.rows.length - rows.length;
  const categoryRules = rulesRes.rows;
  if (subreddit) {
    rows = rows.filter((r) => r.sample_raw?.subreddit === subreddit);
  }
  if (sort === "engaged") {
    rows = [...rows].sort((a, b) => rankOf(a.sample_raw) - rankOf(b.sample_raw));
  }
  // 여러 주제가 합쳐진 "전체"에서는 가장 최근에 성공한 카테고리를 대표로 표시
  const status = [...statusRes.rows].sort((a, b) => (b.last_success_at ?? "").localeCompare(a.last_success_at ?? ""))[0];

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
        <h2 className="font-serif" style={{ fontSize: 18 }}>
          Reddit <span style={{ fontSize: 13, color: "#aaa", fontWeight: 400 }}>({rows.length}개 키워드)</span>
        </h2>
        <span
          style={{
            fontSize: 11,
            padding: "2px 8px",
            borderRadius: 999,
            background: status?.state === "ok" || !status ? "var(--color-cream)" : "#fde2e2",
            color: "var(--color-plum)",
          }}
        >
          {status?.state ?? "미실행"} · 마지막 성공 {timeAgo(status?.last_success_at ?? null)}
        </span>
      </div>

      <p style={{ fontSize: 12.5, color: "#999", marginBottom: 12, lineHeight: 1.6 }}>
        매주 월요일 새벽 05:20(KST)에 등록된 서브레딧(주제별 게시판)에서 이번 주 인기글(top, 지난 7일 기준)
        서브레딧당 최대 10개를 가져옵니다. {topicLabel(topic)}에 등록된 소스 {categoryRules.length}곳:{" "}
        {categoryRules.length === 0
          ? "없음"
          : categoryRules.map((r) => `r/${r.value}` + (r.enabled ? "" : "(꺼짐)")).join(", ")}
      </p>

      <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 8, flexWrap: "wrap" }}>
        <Link
          href={buildHref(topic, { sort, subreddit: undefined })}
          scroll={false}
          style={{
            fontSize: 11,
            padding: "3px 10px",
            borderRadius: 999,
            border: `1px solid ${!subreddit ? "var(--color-mauve)" : "#ddd"}`,
            color: !subreddit ? "var(--color-mauve)" : "#999",
            textDecoration: "none",
          }}
        >
          전체
        </Link>
        {categoryRules.map((r) => (
          <Link
            key={r.id}
            href={buildHref(topic, { sort, subreddit: r.value })}
            scroll={false}
            style={{
              fontSize: 11,
              padding: "3px 10px",
              borderRadius: 999,
              border: `1px solid ${subreddit === r.value ? "var(--color-mauve)" : "#ddd"}`,
              color: subreddit === r.value ? "var(--color-mauve)" : "#999",
              textDecoration: "none",
            }}
          >
            r/{r.value}
          </Link>
        ))}
      </div>

      <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 12 }}>
        <Link
          href={buildHref(topic, { sort: undefined, subreddit })}
          scroll={false}
          style={{ fontSize: 11, color: !sort ? "var(--color-mauve)" : "#999", fontWeight: !sort ? 600 : 400 }}
        >
          최신순
        </Link>
        <Link
          href={buildHref(topic, { sort: "engaged", subreddit })}
          scroll={false}
          style={{ fontSize: 11, color: sort === "engaged" ? "var(--color-mauve)" : "#999", fontWeight: sort === "engaged" ? 600 : 400 }}
        >
          화제순위순
        </Link>
      </div>

      <details style={{ marginBottom: 16, fontSize: 12.5 }}>
        <summary style={{ cursor: "pointer", color: "var(--color-plum)" }}>⚙ 지금 적용 중인 조건</summary>
        <div style={{ padding: "10px 4px 4px", color: "#888", lineHeight: 1.7 }}>
          <p style={{ margin: "0 0 8px" }}>
            · 수집: 레딧 공개 RSS (top 정렬) — 기본 t=week, r/muacjdiscussion만 t=month
            <br />· 서브레딧당 최대: 25개 (레딧 RSS 기본 제공량)
            <br />· 실행 주기: 매주 월요일 새벽 05:20(KST)
            <br />· 제외 중인 글: {excludedCount}개 (아래 목록에 걸린 제목)
            {subreddit && (
              <>
                <br />· 서브레딧 필터: r/{subreddit}만 보는 중
              </>
            )}
          </p>
          <p style={{ margin: "0 0 4px", color: "var(--color-plum)" }}>제외 단어 목록</p>
          <ul style={{ margin: "0 0 8px", paddingLeft: 16 }}>
            {excludesRes.rows.map((ex) => (
              <li key={ex.id} style={{ marginBottom: 4 }}>
                {ex.value}
                <form action={toggleExclude} style={{ display: "inline", marginLeft: 8 }}>
                  <input type="hidden" name="id" value={ex.id} />
                  <input type="hidden" name="enabled" value={String(ex.enabled)} />
                  <button type="submit" style={{ fontSize: 11, color: ex.enabled ? "var(--color-mauve)" : "#bbb" }}>
                    {ex.enabled ? "켜짐" : "꺼짐"}
                  </button>
                </form>
                <form action={deleteExclude} style={{ display: "inline", marginLeft: 6 }}>
                  <input type="hidden" name="id" value={ex.id} />
                  <button type="submit" style={{ fontSize: 11, color: "#c44" }}>
                    삭제
                  </button>
                </form>
              </li>
            ))}
          </ul>
          <form action={addExclude} style={{ display: "flex", gap: 6 }}>
            <input name="value" placeholder="제외할 제목 단어 추가" style={{ fontSize: 12, padding: "4px 6px", flex: 1 }} />
            <button type="submit" style={{ fontSize: 12, padding: "4px 10px" }}>
              추가
            </button>
          </form>
        </div>
      </details>

      {isAll ? (
        ALL_SECTION_TOPICS.map((s) => {
          const topicRows = rows.filter((r) => categoryToTopic(r.category) === s.topic);
          return (
            <TopicSection key={s.topic} topic={s.topic}>
              {topicRows.length === 0 ? (
                <p style={{ fontSize: 13, color: "#999" }}>아직 수집된 키워드가 없습니다.</p>
              ) : (
                <KeywordTable rows={topicRows} />
              )}
            </TopicSection>
          );
        })
      ) : rows.length === 0 ? (
        <p style={{ fontSize: 13, color: "#bbb", marginBottom: 8 }}>아직 수집된 키워드가 없습니다.</p>
      ) : (
        <KeywordTable rows={rows} />
      )}

      <section style={{ borderTop: "1px solid #eee", paddingTop: 24, marginTop: 32 }}>
        <h2 className="font-serif" style={{ fontSize: 16, marginBottom: 4 }}>
          소스 관리
        </h2>
        <p style={{ fontSize: 12.5, color: "#999", marginBottom: 16 }}>
          위 Reddit이 어디를 도는지 여기서 추가·삭제·켬끔·수동 실행할 수 있습니다. —
          2026-08-21에 Apify로 실제 수집이 확인된 서브레딧만 우선 등록했고, 나머지는 아래에서 직접 추가할 수
          있습니다.
        </p>

        <div style={{ marginBottom: 20 }}>
          <form action={runReddit}>
            <button type="submit" style={{ fontSize: 12, padding: "6px 12px", border: "1px solid #ddd", background: "transparent", color: "var(--color-plum)" }}>
              Reddit 지금 실행
            </button>
          </form>
        </div>

        {isAll ? (
          <p style={{ fontSize: 12, color: "#bbb", marginBottom: 20 }}>
            전체 보기에서는 소스를 추가할 수 없습니다 — 각 주제 페이지에서 추가하세요.
          </p>
        ) : (
          <form action={addRule} style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 20 }}>
            <input type="hidden" name="source" value="reddit" />
            <input type="hidden" name="category" value={categories[0]} />
            <input name="value" placeholder="서브레딧 이름 (예: AsianBeauty)" style={{ fontSize: 13, padding: "6px 8px", flex: 1, minWidth: 240 }} />
            <button type="submit" style={{ fontSize: 13, padding: "6px 14px" }}>
              {topicLabel(topic)}에 추가
            </button>
          </form>
        )}

        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: "1px solid #eee" }}>
              <th style={{ textAlign: "left", padding: "6px 4px", color: "#888", fontWeight: 500 }}>값</th>
              <th style={{ textAlign: "center", padding: "6px 4px", color: "#888", fontWeight: 500 }}>사용</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rulesRes.rows.map((rule) => (
              <tr key={rule.id} style={{ borderBottom: "1px solid #f5f5f5" }}>
                <td style={{ padding: "8px 4px", wordBreak: "break-all", maxWidth: 300 }}>{rule.value}</td>
                <td style={{ padding: "8px 4px", textAlign: "center" }}>
                  <form action={toggleRule}>
                    <input type="hidden" name="id" value={rule.id} />
                    <input type="hidden" name="category" value={rule.category} />
                    <input type="hidden" name="source" value="reddit" />
                    <input type="hidden" name="enabled" value={String(rule.enabled)} />
                    <button
                      type="submit"
                      style={{ fontSize: 11, padding: "2px 10px", borderRadius: 999, background: rule.enabled ? "var(--color-cream)" : "#f0f0f0", color: rule.enabled ? "var(--color-plum)" : "#999", border: "none" }}
                    >
                      {rule.enabled ? "켜짐" : "꺼짐"}
                    </button>
                  </form>
                </td>
                <td style={{ padding: "8px 4px", textAlign: "right" }}>
                  <form action={deleteRule}>
                    <input type="hidden" name="id" value={rule.id} />
                    <input type="hidden" name="category" value={rule.category} />
                    <input type="hidden" name="source" value="reddit" />
                    <button type="submit" style={{ fontSize: 11, padding: "4px 8px", color: "#c44" }}>
                      삭제
                    </button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
