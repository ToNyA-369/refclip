const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
function harness({ fail, disconnect, response, delayCommit = false } = {}) {
  let listener, lost, commit; const sent = [];
  const chrome = { runtime: { connectNative: () => ({
    onMessage: { addListener: fn => listener = fn }, onDisconnect: { addListener: fn => lost = fn },
    disconnect() {}, postMessage(msg) {
      sent.push(msg);
      if (disconnect === msg.op) return queueMicrotask(lost);
      if (msg.op === 'commit' && delayCommit) { commit = () => listener({ ok: true, path: 'D:\\Art\\test.png' }); return; }
      queueMicrotask(() => listener(fail === msg.op ? { ok: false, error: 'disk failed' } : { ok: true, path: 'D:\\Art\\test.png' }));
    }
  }) } };
  const context = vm.createContext({ chrome, console, setTimeout, clearTimeout, URL, Uint8Array, AbortController, TypeError,
    btoa: value => Buffer.from(value, 'binary').toString('base64'), fetch: async () => response || new Response(Buffer.from([137,80,78,71]), { headers: { 'content-type': 'image/png' } }) });
  for (const file of ['shared.js','native.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), context);
  return { context, sent, save: url => vm.runInContext(`saveNative(${JSON.stringify(url || 'https://test/image')})`, context), commit: () => commit() };
}
test('native save waits for committed file and transfers exact bytes', async () => {
  const bytes = Buffer.alloc(400000, 123), h = harness({ response: new Response(bytes, { headers: { 'content-type': 'image/png' } }), delayCommit: true });
  let done = false; const result = h.save().then(r => { done = true; return r; });
  while (!h.sent.some(m => m.op === 'commit')) await new Promise(r => setImmediate(r));
  assert.equal(done, false);
  const chunks = h.sent.filter(m => m.op === 'chunk').map(m => Buffer.from(m.data, 'base64'));
  assert.deepEqual(Buffer.concat(chunks), bytes); assert.equal(chunks.length, 3);
  h.commit(); assert.equal((await result).path, 'D:\\Art\\test.png');
});
test('native disk failures and disconnect reject without success or alternate save', async () => {
  for (const option of [{ fail: 'begin' }, { fail: 'commit' }, { disconnect: 'chunk' }]) {
    const h = harness(option); await assert.rejects(h.save());
    assert.equal(h.sent.filter(m => m.op === 'begin').length, 1);
  }
});
test('native rejects HTML, oversized responses and HTTP errors before writing', async () => {
  for (const response of [new Response('login', { headers: { 'content-type': 'text/html' } }),
    new Response('x', { headers: { 'content-type': 'image/png', 'content-length': String(21*1024*1024) } }),
    new Response('no', { status: 403 })]) {
    const h = harness({ response }); await assert.rejects(h.save()); assert.equal(h.sent.some(m => m.op === 'begin'), false);
  }
});
