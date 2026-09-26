// Local integration test only. Refuse to start unless explicitly isolated.
if (process.env.BOARD_FIXTURE_DB !== '1' || process.env.DATABASE_URL !== 'postgres://fixture.invalid/test') {
  throw Error('Fixture DB requires an isolated test process');
}
const run = process.env.BOARD_FIXTURE_RUN;
const card = { id: '1', title: 'Fixture title', url: 'https://example.com/post', body: 'body',
  sub: 'KoreanBeauty', rank: 1, area: '피부', type: '질문', topic: 'Fixture topic',
  summary_ko: 'Fixture summary', worth: 90, worth_parts: {}, gap: 'gap',
  angles: [{ ko: 'Fixture angle', en: 'angle', guide: 'guide' },
    { ko: 'Second angle', en: 'second', guide: 'second guide' }], detail: {},
  note: null, chosen_angle: 0, misconception: null };
const selected = [{ choice: 0, title: 'Fixture angle', title_en: 'angle', guide: 'guide' }];
class Pool {
  on() {}
  async query(sql, params = []) {
    const s = sql.replace(/\s+/g, ' ');
    console.log('BOARD_SQL ' + JSON.stringify({ sql: s, params }));
    let rows;
    if (s.includes('update idea_cards')) rows = [{ run_id: run }];
    else if (s.includes('from workspaces')) rows = params[0] === 'user-b'
      ? [{ id: `workspace-b-${run}`, name: 'Workspace B' }] : [{ id: `workspace-a-${run}`, name: 'Workspace A' }];
    else if (s.includes('from users')) rows = [{ email: 'fixture@example.com', plan: 'pro', created_at: '2026-09-01' }];
    else if (s.includes('from runs')) rows = params[0] === `workspace-b-${run}` ? [] : [{ id: params[2] === '2026-09-14' ? String(BigInt(run) - 1n) : run,
      week: params[2] || '2026-09-21', kind: 'reddit', status: 'done' }];
    else if (s.includes(' as posts,')) rows = [{ posts: 1, cards: params[0] === '0' ? 0 : 1,
      saved: params[0] !== '0' ? 1 : 0, entities: 1, comments: 1, avg_worth: 90 }];
    else if (s.includes(' as with_cmt')) rows = params[0] === '0' ? [] : [{ area: '피부', n: 1, avg_worth: 90, with_cmt: 1 }];
    else if (s.includes(' as kept,')) rows = params[0] === '0' ? [] : [
      { sub: 'KoreanBeauty', kept: 35, dropped: 2 }, { sub: 'AsianBeauty', kept: 8, dropped: 0 },
    ];
    else if (s.includes('a.worth > 20')) {
      rows = params[0] === '0' ? [] : Array.from({ length: 43 }, (_, i) => ({ ...card,
        id: `stock-${i + 1}`, title: `Stock article ${i + 1}`, topic: `Stock topic ${i + 1}`,
        url: `https://example.com/stock/${i + 1}`, sub: i < 35 ? 'KoreanBeauty' : 'AsianBeauty',
      })).filter(r => !params[1] || r.sub === params[1]).slice(params[3], params[3] + params[2]);
    }
    else if (s.includes('from idea_cards c')) rows = params[0] === '0'
      ? [] : [{ ...(params[0] === String(BigInt(run) - 1n)
        ? { ...card, id: '2', angles: [{ ko: 'Previous week angle', en: 'old', guide: 'old guide' }],
            selections: [{ choice: 0, title: 'Previous week angle', title_en: 'old', guide: 'old guide' }] }
        : { ...card, selections: selected }), status: 'saved' }];
    else if (s.includes('from post_comments where')) rows = [{ mention_id: '1', rank: 1, author: 'a', body: 'comment', body_ko: '댓글' }];
    else if (s.includes('select distinct em.mention_id')) rows = [{ mention_id: '1', ko: '키워드', en: 'keyword' }];
    else if (s.includes('group by em.mention_id')) rows = params[0].map(id => ({ mention_id: id, keywords: ['brand'] }));
    else if (s.includes(' as newest')) rows = [{ feed: 'Fixture feed', n: 65, newest: '2026-09-24' }];
    else if (s.includes('contentSnippet')) rows = Array.from({ length: 65 }, (_, i) => ({
      id: `rss-${i+1}`, feed: 'Fixture feed', title: `RSS article ${i+1}`,
      url: `https://example.com/rss/${i+1}`, day: '2026-09-24', snippet: 'Article snippet',
    })).slice(params[1], params[1] + params[0]);
    else if (s.includes('from entities group by')) rows = [{ kind: 'brand', n: 1 }];
    else if (s.includes(' as asked,')) rows = [{ name: 'keyword', name_ko: '키워드', total: 1, asked: 1, reco: 0, rev: 0 }];
    else if (/^select/i.test(s.trim())) rows = [];
    else throw Error('Unexpected fixture SQL');
    return { rows, rowCount: rows.length };
  }
}
// lib/db.ts already supports this process-local pool slot. This works for both
// ESM and CommonJS pg imports without modifying production application code.
global._pgPool = new Pool();
