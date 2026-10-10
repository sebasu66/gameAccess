const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { listenAvailable, isOrphan, removeOwnedFile } = require('./instance');
const { SourceState } = require('./source-state');
const quiet = { info() {}, warn() {} };
const close = server => new Promise(resolve => server.close(resolve));
test('an occupied port is preserved and an OS-assigned port is selected', async () => {
  const foreign = await listenAvailable(() => http.createServer((req, res) => res.end('foreign')), 0, undefined, quiet);
  let plugin;
  try {
    const occupied = foreign.address().port;
    plugin = await listenAvailable(() => http.createServer((req, res) => res.end('plugin')), occupied, undefined, quiet);
    assert.notEqual(plugin.address().port, occupied);
    assert.equal(await (await fetch('http://127.0.0.1:' + occupied)).text(), 'foreign');
  } finally { if (plugin) await close(plugin); await close(foreign); }
});
test('healthy/fresh instances are preserved; detached or failed old instances qualify', () => {
  const main = { kind: 'main', ageSeconds: 50, hasWindow: true, responding: true, ports: [45000] };
  assert.equal(isOrphan(main), false);
  assert.equal(isOrphan({ ...main, hasWindow: false }), true);
  assert.equal(isOrphan({ ...main, ports: [] }), true);
  assert.equal(isOrphan({ ...main, ageSeconds: 2, hasWindow: false, ports: [] }), false);
  assert.equal(isOrphan({ kind: 'child', parentMissing: false }), false);
  assert.equal(isOrphan({ kind: 'child', parentMissing: true }), true);
});
test('an exiting duplicate cannot unregister the live owner', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'provider-owner-'));
  const file = path.join(dir, 'manifest.json');
  try {
    fs.writeFileSync(file, JSON.stringify({ instanceId: 'live' }));
    removeOwnedFile(file, 'duplicate');
    assert.equal(fs.existsSync(file), true);
    removeOwnedFile(file, 'live');
    assert.equal(fs.existsSync(file), false);
  } finally { fs.rmSync(dir, { recursive: true }); }
});
test('JSON changes and configuration edits mark source state; unchanged refresh does not bump revision', () => {
  const state = new SourceState();
  state.accept([{ title: 'Fixture', url: 'https://example.test/a.zip' }]);
  const revision = state.revision;
  state.accept([{ title: 'Fixture', url: 'https://example.test/a.zip' }]);
  assert.equal(state.revision, revision);
  state.markDirty();
  assert.equal(state.dirty, true);
  assert.equal(state.configVersion, 1);
  state.accept([{ title: 'Fixture', url: 'https://example.test/b.zip' }]);
  assert.equal(state.dirty, false);
  assert.ok(state.revision > revision);
  state.accept([{ title: 'Fixture', url: 'https://example.test/b.zip' }], true);
  assert.equal(state.dirty, true);
});
const electron = process.argv[2];
test('real Electron recovers an orphan, reuses a live instance and observes JSON edits', { skip: !electron, timeout: 90000 }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'provider-native-test-'));
  const appData = path.join(root, 'appdata');
  const settings = path.join(appData, 'GameAccess', 'plugins');
  const feed = path.join(root, 'feed.json');
  const manifest = path.join(settings, 'torrent_provider.json');
  fs.mkdirSync(settings, { recursive: true });
  fs.writeFileSync(feed, JSON.stringify({ name: 'Fixture', downloads: [{ title: 'Fixture', uris: ['https://example.test/a.zip'] }] }));
  fs.writeFileSync(path.join(settings, 'sources_config.json'), JSON.stringify({ sourceUrls: [feed] }));
  for (const file of ['main.js', 'links.js', 'matcher.js', 'feed-cache.js', 'instance.js', 'instance-processes.ps1', 'source-state.js']) {
    fs.copyFileSync(path.join(__dirname, file), path.join(root, file));
  }
  fs.writeFileSync(path.join(root, 'index.html'), '<html><body>Plugin regression test</body></html>');
  const pkg = { name: 'ga-provider-fixture', main: 'legacy.js' };
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify(pkg));
  fs.writeFileSync(path.join(root, 'fixture-main.js'),
    "const {app,BrowserWindow}=require('electron');const fs=require('node:fs');app.setPath('userData',process.env.GA_FIXTURE_DATA);setInterval(()=>{if(fs.existsSync(process.env.GA_FIXTURE_STOP)){const win=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('index.html'));if(win)win.close();}},200);require('./main.js');");
  fs.writeFileSync(path.join(root, 'legacy.js'),
    "const {app}=require('electron');app.setPath('userData',process.env.GA_FIXTURE_DATA);app.whenReady().then(()=>{setInterval(()=>{},1000);console.log('ORPHAN_READY')});");
  const env = { ...process.env, APPDATA: appData, GA_FIXTURE_DATA: path.join(root, 'userdata'),
    GA_FIXTURE_STOP: path.join(root, 'stop'), NODE_PATH: path.resolve(path.dirname(electron), '..', '..') };
  delete env.ELECTRON_RUN_AS_NODE;
  const children = [];
  const launch = entry => {
    const child = spawn(electron, [entry], { cwd: root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    children.push(child); return child;
  };
  const waitFor = async (fn, timeout = 25000) => {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      try { const value = await fn(); if (value) return value; } catch {}
      await new Promise(resolve => setTimeout(resolve, 150));
    }
    throw new Error('Timed out waiting for isolated plugin state');
  };
  try {
    const orphan = launch(root);
    await new Promise((resolve, reject) => { orphan.stdout.on('data', data => { if (String(data).includes('ORPHAN_READY')) resolve(); }); orphan.once('error', reject); });
    await new Promise(resolve => setTimeout(resolve, 16000));
    pkg.main = 'fixture-main.js';
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify(pkg));
    const first = launch(root);
    const initial = await waitFor(() => fs.existsSync(manifest) && JSON.parse(fs.readFileSync(manifest, 'utf8')));
    const health = await waitFor(async () => {
      const value = await (await fetch(initial.endpoint + '/api/health')).json();
      return value.sourceCount === 1 && value;
    });
    await waitFor(() => orphan.exitCode !== null || orphan.signalCode !== null);
    assert.equal(health.pid, first.pid);
    const duplicate = launch(root);
    await waitFor(() => duplicate.exitCode !== null);
    assert.equal(duplicate.exitCode, 0);
    assert.equal(JSON.parse(fs.readFileSync(manifest, 'utf8')).instanceId, initial.instanceId);
    fs.writeFileSync(feed, JSON.stringify({ name: 'Fixture', downloads: [{ title: 'Fixture', uris: ['https://example.test/a.zip', 'https://example.test/b.zip'] }] }));
    await waitFor(async () => {
      const value = await (await fetch(initial.endpoint + '/api/health')).json();
      return value.revision > health.revision && !value.syncing;
    });
    const options = await (await fetch(initial.endpoint + '/api/sources?name=Fixture')).json();
    assert.equal(options.length, 2);
    assert.equal(new URL(options[0].resolverUrl).origin, initial.endpoint);
    fs.writeFileSync(path.join(root, 'stop'), 'close');
    await waitFor(() => first.exitCode !== null);
    assert.equal(fs.existsSync(manifest), false);
  } finally {
    for (const child of children) if (child.exitCode === null && child.signalCode === null) child.kill();
    await new Promise(resolve => setTimeout(resolve, 500));
    try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* Keep a locked fixture for inspection. */ }
  }
});
