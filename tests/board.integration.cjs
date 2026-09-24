// Run after `npm run build`. Real Next server/cache, fixture-only DB.
const { spawn } = require('node:child_process');
const { createHmac } = require('node:crypto');
const { once } = require('node:events');
const assert = require('node:assert/strict');
const path = require('node:path');

const port = 3197;
const origin = `http://127.0.0.1:${port}`;
const secret = 'board-integration-test-only';
const run = String(Date.now()); // isolate persisted Next cache entries on every test run
const cookie = uid => `session=${uid}.${createHmac('sha256', secret).update(uid).digest('hex')}`;
const server = spawn(process.execPath, ['--require', path.join(__dirname, 'fixtures/board-pg.cjs'),
  'node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', String(port)], {
  cwd: path.join(__dirname, '..'),
  env: { ...process.env, NODE_ENV: 'production', BOARD_FIXTURE_DB: '1',
    DATABASE_URL: 'postgres://fixture.invalid/test', BOARD_FIXTURE_RUN: run,
    SESSION_SECRET: secret, CRON_SECRET: 'fixture-only' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let output = '';
server.stdout.on('data', x => output += x);
server.stderr.on('data', x => output += x);
const queries = () => output.split('\n').filter(x => x.startsWith('BOARD_SQL ')).map(x => JSON.parse(x.slice(10)));
const read = async (tab, extra = '', uid = 'user-a') => {
  const n = queries().length;
  const response = await fetch(`${origin}/board?tab=${tab}${extra}`, {
    headers: { cookie: cookie(uid) }, signal: AbortSignal.timeout(15000),
  });
  const html = await response.text();
  assert.equal(response.status, 200);
  assert.ok(!html.includes('"digest"'), 'server render error');
  // Let the child stdout pipe deliver query logs after the HTTP response.
  await new Promise(resolve => setTimeout(resolve, 30));
  return { html, calls: queries().slice(n) };
};
const has = (calls, text) => calls.filter(q => q.sql.includes(text));

(async () => {
  for (let i = 0; !output.includes('Ready in'); i++) {
    if (server.exitCode !== null || i > 100) throw Error('Next server not ready: ' + output);
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  const first = await read('main');
  assert.equal(has(first.calls, 'from workspaces').length, 1, 'request workspace dedup');
  assert.equal(has(first.calls, ' as posts,').length, 1, 'cold common cache');
  assert.equal(has(first.calls, 'from post_comments where').length, 0, 'main does not hydrate comments');
  console.log(`main cold: ${first.calls.length} queries`);
  let ideas;
  for (const tab of ['ideas', 'stock', 'rss', 'mine', 'draft', 'main']) {
    const result = await read(tab);
    if (tab === 'ideas') ideas = result;
    assert.equal(has(result.calls, 'from workspaces').length, 1);
    assert.equal(has(result.calls, ' as posts,').length, 0, `${tab}: summary reused`);
    assert.equal(has(result.calls, 'from runs').filter(q => q.sql.includes('limit 30')).length,
      0, `${tab}: run list reused`);
    if (tab !== 'ideas') assert.equal(has(result.calls, 'from post_comments where').length, 0);
    if (['stock', 'rss', 'mine'].includes(tab)) assert.equal(has(result.calls, 'from idea_cards c').length, 0);
    console.log(`${tab} warm: ${result.calls.length} queries`);
  }
  for (const tab of ['main', 'ideas', 'stock', 'rss', 'mine', 'draft']) {
    const result = await read(tab);
    assert.equal(result.calls.length, 3, `${tab}: only fresh ownership/account/current-run queries remain`);
  }
  const stockPage2 = await read('stock', '&sub=KoreanBeauty&page=2&week=2026-09-14');
  const stockQuery = stockPage2.calls.find(q => q.sql.includes('limit $3 offset $4'));
  assert.deepEqual(stockQuery.params.slice(1), ['KoreanBeauty', 30, 30]);
  assert.ok(stockPage2.html.includes('Stock article 31'));
  assert.ok(!stockPage2.html.includes('Stock article 36'));
  assert.ok(stockPage2.html.includes('35<!-- -->건 중 <!-- -->5<!-- -->건 표시'));
  assert.ok(stockPage2.html.includes('sub=KoreanBeauty&amp;week=2026-09-14&amp;page=1'));
  const rssPage2 = await read('rss', '&page=2');
  assert.ok(rssPage2.html.includes('RSS article 31'));
  assert.ok(!rssPage2.html.includes('RSS article 61'));
  assert.equal(has(rssPage2.calls, 'contentSnippet')[0].params[1], 30);
  const rssPage3 = await read('rss', '&page=999');
  assert.ok(rssPage3.html.includes('RSS article 65'));
  assert.equal(has(rssPage3.calls, 'contentSnippet')[0].params[1], 60);
  const invalidPage = await read('rss', '&page=-1');
  assert.ok(invalidPage.html.includes('RSS article 1'));
  const otherWeek = await read('main', '&week=2026-09-14');
  // The prior stock-page visit already primed this week's common cache.
  assert.equal(has(otherWeek.calls, ' as posts,').length, 0);
  assert.ok(otherWeek.html.includes('week=2026-09-14#card-1'), 'card link preserves week');
  const otherUser = await read('ideas', '', 'user-b');
  assert.ok(otherUser.html.includes('Workspace B'));
  assert.ok(!otherUser.html.includes('Fixture title'), 'empty workspace cannot access cached other run');
  assert.equal(has(otherUser.calls, 'from idea_cards c')[0].params[0], '0');

  const form = [...ideas.html.matchAll(/<form\b[^>]*>[\s\S]*?<\/form>/g)]
    .map(x => x[0]).find(x => x.includes('class="confirm'));
  const action = form.match(/name="(\$ACTION_ID_[^"]+)"/)[1];
  const body = new FormData();
  body.set(action, ''); body.set('id', '1');
  const response = await fetch(`${origin}/board?tab=ideas`, {
    method: 'POST', headers: { cookie: cookie('user-a'), origin }, body,
    signal: AbortSignal.timeout(15000),
  });
  const html = await response.text();
  assert.equal(response.status, 200);
  assert.ok(html.includes('확정됨'), 'real Server Action returns updated card');
  assert.ok(html.includes('확정 <b>1</b>'), 'cached summary immediately refreshed');
  const mainAfterSave = await read('main');
  assert.equal(has(mainAfterSave.calls, ' as asked,').length, 0, 'save keeps global keywords cached');
  assert.equal(has(mainAfterSave.calls, ' as with_cmt').length, 0, 'save keeps areas cached');
  assert.equal(has(mainAfterSave.calls, 'from runs').filter(q => q.sql.includes('limit 30')).length, 0);
  const draft = await read('draft');
  assert.ok(draft.html.includes('Fixture angle'), 'saved card visible in draft');
  assert.equal(has(draft.calls, 'from post_comments where').length, 0);
  assert.equal(has(draft.calls, 'from idea_cards c')[0].params[1], true);
  const edit = async (form, fields) => {
    const action = form.match(/name="(\$ACTION_ID_[^"]+)"/)[1];
    const body = new FormData(); body.set(action, ''); body.set('id', '1');
    for (const [key, value] of Object.entries(fields)) body.set(key, value);
    const before = queries().length;
    const response = await fetch(`${origin}/board?tab=ideas`, {
      method: 'POST', headers: { cookie: cookie('user-a'), origin }, body,
    });
    const html = await response.text();
    assert.equal(response.status, 200);
    await new Promise(resolve => setTimeout(resolve, 30));
    assert.equal(has(queries().slice(before), ' as posts,').length, 0, 'note/angle keeps counts cached');
    return html;
  };
  const forms = [...ideas.html.matchAll(/<form\b[^>]*>[\s\S]*?<\/form>/g)].map(x => x[0]);
  const memo = forms.find(x => x.includes('class="memoform"'));
  assert.ok((await edit(memo, { note: 'Updated memo' })).includes('Updated memo'));
  const angle = forms.find(x => x.includes('name="idx"'));
  await edit(angle, { idx: '1' });
  const updatedDraft = await read('draft');
  assert.ok(updatedDraft.html.includes('Updated memo'));
  assert.ok(updatedDraft.html.includes('<h3>Second angle</h3>'));
  const otherWeekAfter = await read('main', '&week=2026-09-14');
  assert.equal(otherWeekAfter.calls.length, 3, 'editing this run leaves the other run cached');
  const rssAfterSave = await read('rss');
  assert.equal(rssAfterSave.calls.length, 3, 'card edits do not expire RSS data');
  const denied = await fetch(`${origin}/board`, { redirect: 'manual' });
  assert.equal(denied.status, 307);
  console.log('PASS: 6 tabs, pagination/filtering, real cache hits, week/user isolation, targeted save/note/angle refresh, auth');
})().catch(error => {
  console.error(error);
  console.error(output.split('\n').filter(x => !x.startsWith('BOARD_SQL ')).join('\n'));
  process.exitCode = 1;
}).finally(async () => {
  server.kill('SIGTERM');
  if (server.exitCode === null) await once(server, 'exit');
});
