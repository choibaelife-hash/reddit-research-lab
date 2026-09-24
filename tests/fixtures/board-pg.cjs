// Local integration test only. Refuse to start unless explicitly isolated.
if (process.env.BOARD_FIXTURE_DB !== '1' || process.env.DATABASE_URL !== 'postgres://fixture.invalid/test') {
  throw Error('Fixture DB requires an isolated test process');
}
let saved = false;
const run = process.env.BOARD_FIXTURE_RUN;
const card = { id: '1', title: 'Fixture title', url: 'https://example.com/post', body: 'body',
  sub: 'KoreanBeauty', rank: 1, area: '피부', type: '질문', topic: 'Fixture topic',
  summary_ko: 'Fixture summary', worth: 90, worth_parts: {}, gap: 'gap',
  angles: [{ ko: 'Fixture angle', en: 'angle', guide: 'guide' }], detail: {},
  note: null, chosen_angle: 0, misconception: null };
class Pool {
  on() {}
  async query(sql, params = []) {
    const s = sql.replace(/\s+/g, ' ');
    console.log('BOARD_SQL ' + JSON.stringify({ sql: s, params }));
    let rows;
    if (s.includes('update idea_cards')) { saved = !saved; rows = []; }
    else if (s.includes('from workspaces')) rows = params[0] === 'user-b'
      ? [{ id: `workspace-b-${run}`, name: 'Workspace B' }] : [{ id: `workspace-a-${run}`, name: 'Workspace A' }];
    else if (s.includes('from users')) rows = [{ email: 'fixture@example.com', plan: 'pro', created_at: '2026-09-01' }];
    else if (s.includes('from runs')) rows = params[0] === `workspace-b-${run}` ? [] : [{ id: params[2] ? String(BigInt(run) - 1n) : run,
      week: params[2] || '2026-09-21', kind: 'reddit', status: 'done' }];
    else if (s.includes(' as posts,')) rows = [{ posts: 1, cards: params[0] === '0' ? 0 : 1,
      saved: saved && params[0] !== '0' ? 1 : 0, entities: 1, comments: 1, avg_worth: 90 }];
    else if (s.includes(' as with_cmt')) rows = params[0] === '0' ? [] : [{ area: '피부', n: 1, avg_worth: 90, with_cmt: 1 }];
    else if (s.includes('from idea_cards c')) rows = params[0] === '0' || (params[1] && !saved)
      ? [] : [{ ...card, status: saved ? 'saved' : 'candidate' }];
    else if (s.includes('from post_comments where')) rows = [{ mention_id: '1', rank: 1, author: 'a', body: 'comment', body_ko: '댓글' }];
    else if (s.includes('select distinct em.mention_id')) rows = [{ mention_id: '1', ko: '키워드', en: 'keyword' }];
    else if (s.includes('a.worth <= $1')) rows = [{ n: 0 }];
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
