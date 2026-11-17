const crypto = require('node:crypto');
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const PAGE_HOSTS = ['vikingfile.com', '1fichier.com', 'pixeldrain.com', 'qiwi.gg', 'drive.google.com', 'mediafire.com', 'mega.nz', 'krakenfiles.com', 'buzzheavier.com', 'rapidgator.net', 'multiup.org', 'uploadhaven.com', 'megaup.net', 'filemoon.sx', 'rentry.co', 'pastebin.com'];
const onHost = (host, base) => host === base || host.endsWith('.' + base);
function hoster(uri) {
  if (/^magnet:\?/i.test(uri)) return 'torrent';
  const parsed = new URL(uri);
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Unsupported download protocol');
  if (onHost(parsed.hostname, 'gofile.io') && /^\/d\/[\w-]+\/?$/.test(parsed.pathname)) return 'gofile';
  if (PAGE_HOSTS.some(host => onHost(parsed.hostname, host))) return 'browser';
  return /\.torrent$/i.test(parsed.pathname) ? 'torrent' : 'http';
}
function optionsFor(items, name, scoreTitle) {
  const seen = new Set();
  const options = [];
  for (const item of items) {
    const score = scoreTitle(name, item.raw_title);
    if (score < 0.55) continue;
    for (const raw of item.uris || [item.uri]) {
      if (typeof raw !== 'string') continue;
      const uri = raw.trim();
      try { hoster(uri); } catch { continue; }
      if (seen.has(uri)) continue;
      seen.add(uri);
      options.push({ ...item, uri, score, id: crypto.createHash('sha256').update(uri).digest('hex') });
    }
  }
  return options.sort((a, b) => b.score - a.score || Number(hoster(a.uri) === 'browser') - Number(hoster(b.uri) === 'browser'));
}
function assertFileHeaders(headers) {
  const type = String(headers['content-type'] || '').toLowerCase();
  if (['text/html', 'application/xhtml', 'application/json'].some(value => type.includes(value))) {
    throw new Error('La fuente devolvió una página web, no el archivo del juego.');
  }
}
function createResolver({ http, websiteToken, log = console }) {
  let token = process.env.GOFILE_TOKEN || '';
  let authorization;
  const resolved = new Map();
  async function authorize() {
    if (token) return token;
    if (!authorization) authorization = (async () => {
      const wt = await websiteToken('');
      const response = await http.post('https://api.gofile.io/accounts', {}, {
        timeout: 15000, headers: { 'X-Website-Token': wt, 'X-BL': 'en-US', 'User-Agent': USER_AGENT, Referer: 'https://gofile.io/' }
      });
      if (response.data.status !== 'ok' || !response.data.data?.token) throw new Error('Gofile no pudo autorizar la descarga.');
      token = response.data.data.token;
      return token;
    })().finally(() => { authorization = undefined; });
    return authorization;
  }
  async function walk(id, account, visited = new Set()) {
    if (visited.has(id) || visited.size >= 100) return null;
    visited.add(id);
    const wt = await websiteToken(account);
    for (let page = 1; page <= 100; page++) {
      const response = await http.get('https://api.gofile.io/contents/' + encodeURIComponent(id), {
        timeout: 15000, params: { page, pageSize: 1000, sortField: 'createTime', sortDirection: '-1' },
        headers: { Authorization: 'Bearer ' + account, 'X-Website-Token': wt, 'X-BL': 'en-US', 'User-Agent': USER_AGENT, Referer: 'https://gofile.io/' }
      });
      const payload = response.data;
      if (payload.status !== 'ok' || !payload.data) throw new Error('Gofile: ' + (payload.status || 'respuesta inválida'));
      const content = payload.data;
      if (content.canAccess === false) return null;
      if (content.type === 'file' && content.link) return { url: content.link, name: content.name };
      for (const child of Object.values(content.children || {})) {
        if (child.type === 'file' && child.link) return { url: child.link, name: child.name };
        if (child.type === 'folder' && child.canAccess !== false) {
          const file = await walk(child.id, account, visited);
          if (file) return file;
        }
      }
      if (page >= Number(payload.metadata?.totalPages || 1)) break;
    }
    return null;
  }
  async function prepare(uri) {
    const kind = hoster(uri);
    // Viking's current Hydra adapter uses their subscription unlock API.
    // Until GameAccess PLUS supplies an unlocker, keep the user's normal browser flow.
    if (kind === 'browser') return { mode: 'browser', url: uri };
    if (kind !== 'gofile') return { mode: 'direct', url: uri };
    const cached = resolved.get(uri);
    if (cached && cached.expires > Date.now()) return cached.value;
    const id = new URL(uri).pathname.split('/')[2];
    let file;
    const account = await authorize();
    try { file = await walk(id, account); }
    catch (error) {
      if (!process.env.GOFILE_TOKEN && /wrongToken|notAuthenticated|badToken/i.test(error.message)) {
        token = '';
        file = await walk(id, await authorize());
      } else throw error;
    }
    if (!file) throw new Error('Gofile no contiene un archivo de descarga accesible.');
    const cookie = { Cookie: 'accountToken=' + token, 'User-Agent': USER_AGENT };
    const head = await http.head(file.url, { timeout: 15000, headers: cookie });
    assertFileHeaders(head.headers);
    const value = { mode: 'proxy', url: file.url, name: file.name || decodeURIComponent(new URL(file.url).pathname.split('/').pop()) || 'download.bin', headers: cookie };
    // Short lived signed URLs are prepared at download time, not catalog time.
    for (const [key, entry] of resolved) if (entry.expires <= Date.now()) resolved.delete(key);
    resolved.set(uri, { value, expires: Date.now() + 15000 });
    log.info('[Sources] Gofile file resolved; name=' + value.name);
    return value;
  }
  return { prepare };
}
module.exports = { USER_AGENT, hoster, optionsFor, assertFileHeaders, createResolver };
