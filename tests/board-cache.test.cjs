const { test } = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');

test('summary cache separates run IDs and configures collection invalidation', async () => {
  const calls = [];
  const entries = [];
  const summary = loadTs('lib/board-cache.ts', {
    'next/cache': { unstable_cache: (fn, keys, opts) => {
      entries.push({ keys, opts });
      return fn;
    } },
    '@/lib/board-data': {
      getStats: async id => { calls.push(['stats', id]); return { cards: Number(id) }; },
      getAreas: async id => { calls.push(['areas', id]); return []; },
    },
  });
  assert.equal((await summary.getBoardSummary('25')).stats.cards, 25);
  assert.equal((await summary.getBoardSummary('0')).stats.cards, 0);
  assert.deepEqual(calls, [['stats', '25'], ['areas', '25'], ['stats', '0'], ['areas', '0']]);
  assert.deepEqual(entries.find(e => e.keys[0] === 'board-stats-v2' && e.keys[1] === '25').opts,
    { tags: ['board-data', 'board-counts:25'], revalidate: 60 });
  assert.ok(entries.some(e => e.keys[0] === 'board-stats-v2' && e.keys[1] === '0'));
  assert.deepEqual(entries.find(e => e.keys[0] === 'board-areas-v2').opts.tags, ['board-data']);
});

const routes = [
  ['tick', '@/lib/pipeline', 'tick'],
  ['collect-reddit', '@/lib/collectors/reddit', 'collectReddit'],
  ['collect-rss', '@/lib/collectors/rss', 'collectRss'],
  ['collect-comments', '@/lib/collectors/reddit-comments', 'collectComments'],
  ['comment-entities', '@/lib/analyzers/comment-entities', 'extractCommentEntities'],
  ['classify', '@/lib/analyzers/classify', 'classifyPosts'],
  ['build-cards', '@/lib/analyzers/cards', 'buildCards'],
  ['rescore', '@/lib/analyzers/korea-relevance', 'extractRelevance'],
];

for (const [route, dependency, method] of routes) {
  test(`${route}: refresh after success/partial failure, never after unauthorized/peek`, async () => {
    for (const mode of ['success', 'failed', 'denied', 'peek']) {
      const events = [];
      const handler = loadTs(`app/api/cron/${route}/route.ts`, {
        'next/server': { NextResponse: { json: value => value } },
        'next/cache': { revalidateTag: (tag, profile) => {
          assert.equal(tag, 'board-data');
          assert.deepEqual(profile, { expire: 0 });
          events.push('invalidate');
        } },
        '@/lib/cron-auth': { denyCron: () => mode === 'denied' ? { status: 401 } : null },
        [dependency]: {
          [method]: async () => {
            events.push('write');
            if (mode === 'failed') throw Error('partial failure');
            return { ok: true };
          },
          nextStep: async () => 'collect',
        },
        '@/lib/analyzers/score': { rescoreAll: async () => ({ ok: true }) },
      });
      const req = { nextUrl: new URL(`http://localhost/?peek=${mode === 'peek' ? '1' : '0'}`) };
      if (mode === 'failed') await assert.rejects(handler.GET(req), /partial failure/);
      else await handler.GET(req);
      assert.deepEqual(events, mode === 'denied' || (mode === 'peek' && route === 'tick')
        ? [] : ['write', 'invalidate']);
    }
  });
}

test('card edits expire only their run; notes/angles leave counts and collection caches intact', async () => {
  const events = [];
  const actions = loadTs('app/board/actions.ts', {
    '@/lib/db': { pool: { query: async () => { events.push('write'); return { rows: [{ run_id: '25' }] }; } } },
    '@/lib/board-cache': { cardCacheTag: id => `board-cards:${id}`, countCacheTag: id => `board-counts:${id}` },
    'next/cache': {
      updateTag: tag => events.push(tag), refresh: () => events.push('refresh'),
    },
  });
  for (const action of ['toggleConfirm', 'chooseAngle', 'saveNote']) {
    events.length = 0;
    await actions[action](new Map([['id', '1'], ['idx', '0'], ['note', 'memo']]));
    assert.deepEqual(events, action === 'toggleConfirm'
      ? ['write', 'board-cards:25', 'board-counts:25', 'refresh']
      : ['write', 'board-cards:25', 'refresh']);
  }
});

test('external ingestion expires collection cache after writes but not rejected payloads', async () => {
  const oldSecret = process.env.N8N_INGEST_SECRET;
  process.env.N8N_INGEST_SECRET = 'fixture';
  const events = [];
  const { POST } = loadTs('app/api/ingest/route.ts', {
    'next/server': { NextResponse: { json: value => value } },
    'next/cache': { revalidateTag: () => events.push('invalidate') },
    '@/lib/ingest': { ingestItems: async () => { events.push('write'); return {}; } },
  });
  try {
    await POST({ headers: new Map(), json: async () => ({}) });
    await POST({ headers: new Map([['x-api-key', 'fixture']]), json: async () => ({}) });
    assert.deepEqual(events, []);
    await POST({ headers: new Map([['x-api-key', 'fixture']]), json: async () => ({ source: 'rss', items: [] }) });
    assert.deepEqual(events, ['write', 'invalidate']);
  } finally {
    if (oldSecret === undefined) delete process.env.N8N_INGEST_SECRET;
    else process.env.N8N_INGEST_SECRET = oldSecret;
  }
});
