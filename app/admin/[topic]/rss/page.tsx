import { pool } from "@/lib/db";
import { addRule, deleteRule, toggleRule, runRss } from "@/lib/actions/rules";
import { promoteKeyword } from "@/lib/actions/keywords";
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

function hostLabel(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
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
        {rows.map((row) => (
          <tr key={row.id} style={{ borderBottom: "1px solid #f5f5f5" }}>
            <td className="font-serif" style={{ padding: "8px 4px", fontWeight: 600 }}>
              {row.label}
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
                  <input type="hidden" name="source" value="rss" />
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
        ))}
      </tbody>
    </table>
  );
}

export default async function RssPage({ params }: { params: Promise<{ topic: string }> }) {
  const { topic } = await params;
  const categories = topicToCategories(topic);
  const isAll = topic === "all";

  const [rowsRes, rulesRes, statusRes] = await Promise.all([
    pool.query<KeywordRow>(
      `select k.id, k.label, k.status, k.category, k.first_seen_at,
              count(m.id)::int as mention_count,
              (array_agg(m.title order by m.occurred_at desc))[1] as sample_title,
              (array_agg(m.url order by m.occurred_at desc))[1] as sample_url,
              max(m.occurred_at) as last_mention_at
       from keywords k
       join mentions m on m.keyword_id = k.id and m.source = 'rss'
       where k.category = any($1::text[]) and k.status != 'archived'
       group by k.id
       order by last_mention_at desc
       limit 50`,
      [categories]
    ),
    pool.query<Rule>(
      `select id, category, source, value, enabled from collection_rules where source = 'rss' and category = any($1::text[]) order by value`,
      [categories]
    ),
    pool.query<SourceStatus>(
      `select last_success_at, last_count, state from source_status where source = 'rss' and category = any($1::text[])`,
      [categories]
    ),
  ]);

  const rows = rowsRes.rows;
  const categoryRules = rulesRes.rows;
  // 여러 주제가 합쳐진 "전체"에서는 가장 최근에 성공한 카테고리를 대표로 표시
  const status = [...statusRes.rows].sort((a, b) => (b.last_success_at ?? "").localeCompare(a.last_success_at ?? ""))[0];

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
        <h2 className="font-serif" style={{ fontSize: 18 }}>
          RSS <span style={{ fontSize: 13, color: "#aaa", fontWeight: 400 }}>({rows.length}개 키워드)</span>
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

      <p style={{ fontSize: 12.5, color: "#999", marginBottom: 20, lineHeight: 1.6 }}>
        매일 새벽 05:30(KST)에 등록된 뉴스/블로그 사이트에 새 글이 올라왔는지 확인합니다. 특정 키워드를 검색하는 게
        아니라, 사이트 자체를 구독하는 방식입니다. {topicLabel(topic)}에 등록된 소스 {categoryRules.length}곳:{" "}
        {categoryRules.length === 0
          ? "없음"
          : categoryRules.map((r) => hostLabel(r.value) + (r.enabled ? "" : "(꺼짐)")).join(", ")}
      </p>

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
          위 RSS가 어디를 도는지 여기서 추가·삭제·켬끔·수동 실행할 수 있습니다.
        </p>

        <div style={{ marginBottom: 20 }}>
          <form action={runRss}>
            <button type="submit" style={{ fontSize: 12, padding: "6px 12px", border: "1px solid #ddd", background: "transparent", color: "var(--color-plum)" }}>
              RSS 지금 실행
            </button>
          </form>
        </div>

        {isAll ? (
          <p style={{ fontSize: 12, color: "#bbb", marginBottom: 20 }}>
            전체 보기에서는 소스를 추가할 수 없습니다 — 각 주제 페이지에서 추가하세요.
          </p>
        ) : (
          <form action={addRule} style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 20 }}>
            <input type="hidden" name="source" value="rss" />
            <input type="hidden" name="category" value={categories[0]} />
            <input name="value" placeholder="RSS URL" style={{ fontSize: 13, padding: "6px 8px", flex: 1, minWidth: 240 }} />
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
                    <input type="hidden" name="source" value="rss" />
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
                    <input type="hidden" name="source" value="rss" />
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
