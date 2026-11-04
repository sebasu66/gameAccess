// One-click install (apps/api/app/web_install.py): the button asks the server for a session, copies its command and
// shows each step as the script on the player's PC reports it. The server address is fixed; a copy of the page served
// from this computer (localhost) may point at a local server with ?api=http://127.0.0.1:<port>, never elsewhere.
(() => {
const button = document.getElementById('magic-install');
const panel = document.getElementById('install-flow');
if (!button || !panel) return;
const DEFAULT_API = 'https://gameaccess-api-dev.onrender.com';
const LOCAL = /^(localhost|127\.0\.0\.1)$/;
const api = (() => {
  const asked = new URLSearchParams(location.search).get('api');
  if (!asked || !LOCAL.test(location.hostname)) return DEFAULT_API;
  try { const url = new URL(asked); return LOCAL.test(url.hostname) ? url.origin : DEFAULT_API; } catch { return DEFAULT_API; }
})();
const STEPS = ['connected', 'windows', 'smartapp', 'webview', 'steam', 'download', 'verify', 'install', 'open'];
const commandBox = document.getElementById('install-command');
const copyButton = document.getElementById('install-copy');
const status = document.getElementById('install-status');
const list = document.getElementById('install-steps');
const REASONS = ['uac_declined', 'sac_on', 'windows_old', 'hash_mismatch', 'no_release', 'steam_missing', 'webview_failed', 'webview_unsigned', 'not_found'];
let session = null;
let timer = 0;

// Texts come from i18n.js through data-i18n, so a language switch translates them too.
function setText(el, key, vars) {
  el.dataset.i18n = key;
  if (vars) el.dataset.i18nVars = JSON.stringify(vars); else delete el.dataset.i18nVars;
  document.dispatchEvent(new Event('ga-i18n-refresh'));
}
const key = name => 'st' + name[0].toUpperCase() + name.slice(1);

function drawSteps() {
  list.replaceChildren(...STEPS.map(name => {
    const li = document.createElement('li');
    li.dataset.step = name;
    li.dataset.state = 'pending';
    const label = document.createElement('span');
    label.className = 'install-step-label';
    label.dataset.i18n = key(name);
    const detail = document.createElement('span');
    detail.className = 'install-step-detail';
    li.append(label, detail);
    if (name === 'download') {
      const bar = document.createElement('span');
      bar.className = 'install-bar';
      bar.append(document.createElement('i'));
      li.append(bar);
    }
    return li;
  }));
  document.dispatchEvent(new Event('ga-i18n-refresh'));
}

const DETAILS = { found: 'dtFound', installing: 'dtInstalling', installed: 'dtInstalled' };
function show(state) {
  for (const name of STEPS) {
    const li = list.querySelector(`[data-step="${name}"]`);
    const step = state.steps[name];
    if (!li || !step) continue;
    li.dataset.state = step.state;
    const detail = li.querySelector('.install-step-detail');
    if (name === 'download' && step.state === 'running' && /^\d+\/\d+$/.test(step.detail)) detail.textContent = `${step.detail} MB`;
    else if (step.state === 'skip' && step.detail === 'installed') setText(detail, 'dtAlready');
    else if (DETAILS[step.detail] && step.state !== 'error') setText(detail, DETAILS[step.detail]);
    else if (step.state !== 'running') { delete detail.dataset.i18n; detail.textContent = ''; }
    const bar = li.querySelector('.install-bar i');
    if (bar) bar.style.width = `${step.state === 'ok' || step.state === 'skip' ? 100 : step.progress || 0}%`;
  }
  if (state.done) { setText(status, 'imDone'); status.dataset.tone = 'done'; return true; }
  if (state.failed) {
    const failed = Object.values(state.steps).find(step => step.state === 'error');
    const reason = failed && REASONS.includes(failed.detail) ? failed.detail : '';
    setText(status, reason ? 'er' + reason[0].toUpperCase() + reason.slice(1) : 'erGeneric');
    status.dataset.tone = 'error';
    return true;
  }
  setText(status, Object.keys(state.steps).length ? 'imRunning' : state.fetched ? 'imFetched' : 'imWaiting');
  status.dataset.tone = '';
  return false;
}

async function poll() {
  if (!session) return;
  try {
    const response = await fetch(`${api}/install/sessions/${session.code}`, { cache: 'no-store' });
    if (response.status === 404) { setText(status, 'imExpired'); status.dataset.tone = 'error'; return; }
    if (response.ok && show(await response.json())) return;
  } catch { /* the next poll tries again */ }
  timer = setTimeout(poll, 1000);
}

async function copy(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* fall back to selecting it */ }
  const range = document.createRange();
  range.selectNodeContents(commandBox);
  getSelection().removeAllRanges();
  getSelection().addRange(range);
  try { return document.execCommand('copy'); } catch { return false; }
}

async function start() {
  clearTimeout(timer);
  panel.hidden = false;
  panel.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'nearest' });
  drawSteps();
  commandBox.textContent = '…';
  setText(status, 'imPreparing');
  status.dataset.tone = '';
  button.disabled = true;
  try {
    const response = await fetch(`${api}/install/sessions`, { method: 'POST' });
    if (!response.ok) throw new Error(String(response.status));
    session = await response.json();
  } catch {
    session = null;
    setText(status, 'imOffline');
    status.dataset.tone = 'error';
    button.disabled = false;
    return;
  }
  button.disabled = false;
  commandBox.textContent = session.command;
  if (await copy(session.command)) setText(copyButton, 'imCopied');
  poll();
}

button.addEventListener('click', start);
copyButton.addEventListener('click', async () => { if (session && await copy(session.command)) setText(copyButton, 'imCopied'); });
// The server sleeps when nobody uses it: wake it while the player reads the page, so the code arrives at once.
fetch(`${api}/health`, { cache: 'no-store' }).catch(() => {});
})();
