const { test } = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');

test('summary cache separates run IDs and configures collection invalidation', async () => {
  const calls = [];
  let options;
  const summary = loadTs('lib/board-cache.ts', {
    'next/cache': { unstable_cache: (fn, keys, opts) => {
      assert.deepEqual(keys, ['board-summary-v1']);
      options = opts;
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
  assert.deepEqual(options, { tags: ['board-data'], revalidate: 60 });
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

test('all card edits expire summary before refreshing the page', async () => {
  const events = [];
  const actions = loadTs('app/board/actions.ts', {
    '@/lib/db': { pool: { query: async () => { events.push('write'); } } },
    'next/cache': {
      updateTag: tag => events.push(tag), revalidatePath: path => events.push(path),
    },
  });
  for (const action of ['toggleConfirm', 'chooseAngle', 'saveNote']) {
    events.length = 0;
    await actions[action](new Map([['id', '1'], ['idx', '0'], ['note', 'memo']]));
    assert.deepEqual(events, ['write', 'board-data', '/board']);
  }
});
