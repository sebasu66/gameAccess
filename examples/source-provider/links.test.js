const { test } = require('node:test');
const assert = require('node:assert/strict');
const { optionsFor, hoster, createResolver, assertFileHeaders, USER_AGENT } = require('./links');
const feed = (uris, name = 'Feed A') => ({ raw_title: 'Fixture', uris, source_name: name, file_size: '6 GB' });
test('every URI becomes a distinct option; duplicates and invalid protocols are removed', () => {
  const options = optionsFor([feed(['https://example.test/a.zip', 'magnet:?xt=urn:btih:abc', 'javascript:alert(1)']),
    feed(['https://example.test/a.zip', 'https://example.test/b.zip'], 'Feed B')], 'Fixture', () => 0.8);
  assert.equal(options.length, 3);
  assert.equal(new Set(options.map(item => item.id)).size, 3);
  assert.deepEqual([...new Set(options.map(item => item.source_name))], ['Feed A', 'Feed B']);
});
test('host recognition checks hostname boundaries, not URL text', () => {
  assert.equal(hoster('https://vikingfile.com/f/ABC'), 'browser');
  assert.equal(hoster('https://vikingfile.com.evil.test/file.zip'), 'http');
  assert.equal(hoster('https://example.test/vikingfile.com.zip'), 'http');
  assert.equal(hoster('https://gofile.io/d/ABC'), 'gofile');
  assert.equal(hoster('https://example.test/a.torrent'), 'torrent');
});
test('Viking and magnets do not call GameAccess or invent an unlock service', async () => {
  const resolver = createResolver({ http: { post() { throw Error('Unexpected network'); } } });
  assert.deepEqual(await resolver.prepare('https://vikingfile.com/f/ABC'), { mode: 'browser', url: 'https://vikingfile.com/f/ABC' });
  assert.deepEqual(await resolver.prepare('magnet:?xt=urn:btih:abc'), { mode: 'direct', url: 'magnet:?xt=urn:btih:abc' });
});
test('Gofile traverses folders, uses dynamic website tokens and keeps the cookie in its proxy', async () => {
  const visited = [];
  const tokens = [];
  const http = {
    post: async (url, body, options) => {
      assert.equal(url, 'https://api.gofile.io/accounts');
      assert.equal(options.headers['X-Website-Token'], 'wt-');
      assert.equal(options.headers['User-Agent'], USER_AGENT);
      return { data: { status: 'ok', data: { token: 'guest' } } };
    },
    get: async (url, options) => {
      visited.push(url);
      assert.equal(options.headers.Authorization, 'Bearer guest');
      assert.equal(options.headers['X-Website-Token'], 'wt-guest');
      return { data: { status: 'ok', data: url.endsWith('/ABC')
        ? { type: 'folder', children: { one: { type: 'folder', id: 'nested' } } }
        : { type: 'folder', children: { one: { type: 'file', name: 'fixture.zip', link: 'https://store.gofile.io/download/fixture.zip' } } } } };
    },
    head: async (url, options) => {
      assert.equal(options.headers.Cookie, 'accountToken=guest');
      return { headers: { 'content-type': 'application/zip' } };
    }
  };
  const resolver = createResolver({ http, websiteToken: async account => { tokens.push(account); return 'wt-' + account; }, log: { info() {} } });
  const prepared = await resolver.prepare('https://gofile.io/d/ABC');
  assert.equal(prepared.mode, 'proxy');
  assert.equal(prepared.name, 'fixture.zip');
  assert.equal(prepared.headers.Cookie, 'accountToken=guest');
  assert.equal(visited.length, 2);
  assert.deepEqual(tokens, ['', 'guest', 'guest']);
  assert.equal(await resolver.prepare('https://gofile.io/d/ABC'), prepared);
  assert.equal(visited.length, 2);
});
test('unavailable Gofile never falls back to the original web page', async () => {
  const resolver = createResolver({
    http: { post: async () => ({ data: { status: 'ok', data: { token: 'guest' } } }),
      get: async () => ({ data: { status: 'error-notFound' } }) },
    websiteToken: async () => 'wt'
  });
  await assert.rejects(resolver.prepare('https://gofile.io/d/missing'), /error-notFound/);
});
test('HTML and JSON responses cannot be passed off as download files', () => {
  assert.throws(() => assertFileHeaders({ 'content-type': 'text/html; charset=utf-8' }), /página web/);
  assert.throws(() => assertFileHeaders({ 'content-type': 'application/json' }), /página web/);
  assert.doesNotThrow(() => assertFileHeaders({ 'content-type': 'application/octet-stream' }));
});

const { calculateScore } = require('./matcher');
test('TRAIL OUT does not match Rail Route, but keeps its own download release', () => {
  assert.equal(calculateScore('TRAIL OUT', 'Rail Route 2.3.20'), 0);
  assert.ok(calculateScore('TRAIL OUT', 'TRAIL OUT Free Download (v5.06)') > 0.8);
  const options = optionsFor([{ ...feed(['https://example.test/trail.zip']), raw_title: 'TRAIL OUT Free Download (v5.06)' },
    { ...feed(['magnet:?xt=urn:btih:rail']), raw_title: 'Rail Route 2.3.20' }], 'TRAIL OUT', calculateScore);
  assert.equal(options.length, 1);
  assert.equal(options[0].uri, 'https://example.test/trail.zip');
});
test('game numbers and complete word boundaries distinguish sequels', () => {
  assert.equal(calculateScore('Alan Wake', 'Alan Wake 2 v1.3'), 0);
  assert.ok(calculateScore('Alan Wake 2', 'Alan Wake 2 (v1.3) [Repack]') > 0.8);
  assert.equal(calculateScore('DOOM', 'DOOM Eternal'), 0);
  assert.equal(calculateScore('Out', 'Outlast'), 0);
  assert.ok(calculateScore("Marvel's Spider-Man", 'Marvels Spider-Man (v1.2)') > 0.8);
});
