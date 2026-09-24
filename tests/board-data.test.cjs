const { test } = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');

function fixture(cards) {
  const calls = [];
  const pool = { query: async (sql, params) => {
    calls.push({ sql, params });
    if (/from post_comments\s+where/.test(sql)) return { rows: [
      { mention_id: '1', rank: 1, author: 'a', body: 'first', body_ko: null },
      { mention_id: '1', rank: 2, author: 'b', body: 'second', body_ko: '둘째' },
    ] };
    if (sql.includes('from entity_mentions em')) return { rows: [
      { mention_id: '2', ko: null, en: 'B' },
      { mention_id: '1', ko: '가', en: 'A' },
      { mention_id: '1', ko: 'same', en: 'same' },
    ] };
    return { rows: cards.map(c => ({ ...c })) };
  } };
  return { data: loadTs('lib/board-data.ts', { '@/lib/db': { pool } }), calls };
}

test('12 cards use 3 queries and details are grouped without losing comment order', async () => {
  const { data, calls } = fixture(Array.from({ length: 12 }, (_, i) => ({ id: String(i + 1) })));
  const cards = await data.getCards('25');
  assert.equal(calls.length, 3);
  assert.deepEqual(cards[0].comments.map(c => c.body), ['first', 'second']);
  assert.deepEqual(cards[0].keywords, ['가 / A', 'same']);
  assert.deepEqual(cards[1].keywords, ['B']);
  assert.deepEqual(cards[2].comments, []);
  assert.deepEqual(cards[2].keywords, []);
  // mention IDs are UUIDs; only run IDs are bigint.
  assert.match(calls[1].sql, /any\(\$1::uuid\[\]\)/);
  assert.match(calls[2].sql, /any\(\$1::uuid\[\]\)/);
  assert.equal(calls[1].params[0].length, 12);
});

test('empty run only executes the base query', async () => {
  const { data, calls } = fixture([]);
  assert.deepEqual(await data.getCards('0'), []);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].params[0], '0');
});

test('draft filters saved cards in SQL and never queries comments', async () => {
  const { data, calls } = fixture([{ id: '1' }]);
  const cards = await data.getCards('25', { savedOnly: true, includeComments: false });
  assert.equal(calls.length, 2);
  assert.match(calls[0].sql, /c\.status = 'saved'/);
  assert.equal(calls[0].params[1], true);
  assert.ok(calls.every(c => !/from post_comments\s+where/.test(c.sql)));
  assert.deepEqual(cards[0].comments, []);
  assert.deepEqual(cards[0].keywords, ['가 / A', 'same']);
});

test('summary has one narrow query without comments, body, or detailed evidence', async () => {
  const { data, calls } = fixture([{ id: '1' }]);
  await data.getCardSummaries('25');
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].params, ['25']);
  assert.doesNotMatch(calls[0].sql, /post_comments|entity_mentions|c\.detail|as body/);
});

test('stats includes saved count so navigation does not need to load cards', async () => {
  const { data, calls } = fixture([{ cards: 12, saved: 2 }]);
  assert.equal((await data.getStats('25')).saved, 2);
  assert.match(calls[0].sql, /status = 'saved'/);
});

test('stock page filters in SQL and batches keywords for only its page', async () => {
  const calls = [];
  const data = loadTs('lib/board-data.ts', { '@/lib/db': { pool: { query: async (sql, params) => {
    calls.push({ sql, params });
    return { rows: sql.includes('group by em.mention_id')
      ? [{ mention_id: 'item-1', keywords: ['brand'] }]
      : [{ id: 'item-1', title: 'first' }, { id: 'item-2', title: 'second' }] };
  } } } });
  const rows = await data.getStockPage('25', 'KoreanBeauty', 2);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].params, ['25', 'KoreanBeauty', 30, 30]);
  assert.match(calls[0].sql, /m\.raw->>'subreddit' = \$2/);
  assert.match(calls[0].sql, /order by a\.worth desc, m\.id/);
  assert.doesNotMatch(calls[0].sql, /array_agg/);
  assert.deepEqual(calls[1].params, [['item-1', 'item-2']]);
  assert.deepEqual(rows.map(r => r.keywords), [['brand'], []]);
});

test('RSS pagination uses bounded rows and deterministic ordering', async () => {
  const { data, calls } = fixture([]);
  await data.getRssItems(30, 60);
  assert.deepEqual(calls[0].params, [30, 60]);
  assert.match(calls[0].sql, /order by occurred_at desc, id desc limit \$1 offset \$2/);
});
