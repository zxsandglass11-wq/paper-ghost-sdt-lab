'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

function session(overrides) {
  return Object.assign({ id: 'session-1', createdAt: '2026-09-29T12:00:00.000Z',
    config: { count: 20, prior: 0.5, dPrime: 4, mode: 'survey', exposureMs: 1000 },
    trials: Array.from({ length: 20 }, (_, i) => ({ signal: i < 10, response: i < 8 || i === 18, responseMs: 250 + i, seed: i })),
    seed: 1234, practice: false, challengeId: 'pair-1', device: { width: 1200, height: 800, dpr: 2 }
  }, overrides);
}
function fresh(storage) {
  if (storage === undefined) delete global.localStorage;
  else global.localStorage = storage;
  const file = path.resolve(__dirname, '../storage.js');
  delete require.cache[file];
  return require(file);
}
function memoryStorage() {
  const map = new Map();
  return { getItem: k => map.has(k) ? map.get(k) : null, setItem: (k, v) => map.set(k, v), removeItem: k => map.delete(k) };
}

test('versioned and plain exports round trip only schema fields; derived scores are discarded', () => {
  const store = fresh(memoryStorage());
  const source = session({ stats: { dPrime: 999 }, script: '<script>bad()</script>' });
  source.config.extra = true;
  source.trials[0].secret = 'not retained';
  const parsed = store.parseImport(store.serialize([source]));
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].stats, undefined);
  assert.equal(parsed[0].config.extra, undefined);
  assert.equal(parsed[0].trials[0].secret, undefined);
  assert.deepEqual(store.parseImport(JSON.stringify(parsed)), parsed);
  assert.deepEqual(store.parseImport('\uFEFF' + store.serialize(parsed)), parsed);
});

test('rejects incomplete sessions, inconsistent quotas, duplicate ids, and practice sessions', () => {
  const store = fresh();
  const incomplete = session(); incomplete.trials.pop();
  assert.throws(() => store.serialize([incomplete]), /试次数/);
  const quota = session(); quota.trials[0].signal = false;
  assert.throws(() => store.serialize([quota]), /先验/);
  assert.throws(() => store.serialize([session(), session()]), /重复/);
  assert.throws(() => store.serialize([session({ practice: true })]), /正式局/);
});

test('rejects unsupported parameters, nonfinite numbers, invalid booleans, invalid dates and seeds', () => {
  const store = fresh();
  for (const patch of [{ count: 21 }, { prior: 0.2 }, { dPrime: 0 }, { mode: '__proto__' }, { exposureMs: 500 }]) {
    const s = session(); Object.assign(s.config, patch);
    assert.throws(() => store.serialize([s]), /参数/);
  }
  for (const value of [NaN, Infinity, -1, '100']) {
    const s = session(); s.trials[0].responseMs = value;
    assert.throws(() => store.serialize([s]), /作答格式/);
  }
  const b = session(); b.trials[0].response = 1;
  assert.throws(() => store.serialize([b]), /作答格式/);
  for (const seed of [-1, 4294967296, 1.5, '123']) assert.throws(() => store.serialize([session({ seed })]), /种子/);
  for (const createdAt of ['today', '2026-02-31T12:00:00.000Z', '2026-09-29']) assert.throws(() => store.serialize([session({ createdAt })]), /日期/);
  assert.throws(() => store.serialize([session({ device: { width: 0, height: 600, dpr: 1 } })]), /设备/);
});

test('rejects malformed, oversized and unknown version imports', () => {
  const store = fresh();
  assert.throws(() => store.parseImport('{'), /JSON/);
  assert.throws(() => store.parseImport('x'.repeat(3 * 1024 * 1024 + 1)), /3 MB/);
  assert.throws(() => store.parseImport(JSON.stringify({ format: 'paper-ghost', version: 2, sessions: [] })), /支持/);
  assert.throws(() => store.parseImport(JSON.stringify({ sessions: [] })), /支持/);
  assert.throws(() => store.serialize(Array.from({ length: 31 }, (_, i) => session({ id: String(i) }))), /最多/);
});

test('persists records; save retains the newest 30 supplied sessions', () => {
  const browser = memoryStorage(), store = fresh(browser);
  assert.deepEqual(store.load(), { sessions: [], persistent: true });
  assert.deepEqual(store.save(Array.from({ length: 35 }, (_, i) => session({ id: String(i) }))), { persistent: true });
  const again = fresh(browser).load();
  assert.equal(again.sessions.length, 30);
  assert.equal(again.sessions[0].id, '0');
  assert.equal(again.sessions[29].id, '29');
});

test('disabled or full storage preserves records in memory and does not throw', () => {
  const store = fresh({ getItem: () => null, setItem: () => { throw new Error('quota'); }, removeItem: () => {} });
  assert.equal(store.load().persistent, false);
  const saved = store.save([session()]);
  assert.equal(saved.persistent, false);
  assert.match(saved.error, /导出/);
  assert.equal(store.load().sessions.length, 1);
  const absent = fresh();
  assert.equal(absent.load().persistent, false);
  assert.equal(absent.save([session()]).persistent, false);
  assert.equal(absent.load().sessions.length, 1);
});

test('corrupt browser data safely starts empty; invalid saves do not replace good memory', () => {
  const browser = memoryStorage(); browser.setItem('paper-ghost.sessions.v1', '{broken');
  const store = fresh(browser);
  const loaded = store.load();
  assert.equal(loaded.persistent, false);
  assert.deepEqual(loaded.sessions, []);
  assert.equal(store.save([session()]).persistent, true);
  assert.equal(store.save([session({ practice: true })]).persistent, false);
  assert.equal(store.load().sessions.length, 1);
});

test('CSV uses real trial outcomes, recomputes all summary fields and escapes identifiers', () => {
  const store = fresh();
  const s = session({ id: '=HYPERLINK("bad")', stats: { dPrime: 999 } });
  const csv = store.csv([s]);
  assert.ok(csv.startsWith('\uFEFF'));
  assert.equal(csv.split('\r\n').length, 22);
  assert.match(csv, /"'=HYPERLINK\(""bad""\)"/);
  assert.match(csv, /"H 命中"/);
  assert.match(csv, /"FA 虚报"/);
  assert.match(csv, /"8","2","1","9"/);
  assert.doesNotMatch(csv, /999/);
  assert.match(csv, /"9"\r\n/); // survey cost = 4*2 + 1*1.
});
