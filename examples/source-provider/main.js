const { app, BrowserWindow, ipcMain } = require('electron');
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const log = require('electron-log');
const { calculateScore } = require('./matcher');
const { USER_AGENT, hoster, optionsFor, assertFileHeaders, createResolver } = require('./links');

log.transports.file.level = 'info';

let server;
const PORT = 45000;
let cachedDownloads = [];
let downloadOptions = new Map();
let titleIndex = new Map();
let isSyncing = false;
let retrySyncTimer;



function getConfigPath() {
    return path.join(getPluginDir(), 'sources_config.json');
}

function loadConfig() {
    const configPath = getConfigPath();
    if (fs.existsSync(configPath)) {
        try {
            const data = JSON.parse(fs.readFileSync(configPath, 'utf8'));
            if (data && Array.isArray(data.sourceUrls)) {
                return data.sourceUrls;
            }
        } catch (e) { log.error("Error loading config:", e); }
    }
    return [];
}

function saveConfig(urls) {
    const configPath = getConfigPath();
    fs.writeFileSync(configPath, JSON.stringify({ sourceUrls: urls }, null, 2), 'utf8');
}

let SOURCE_URLS = loadConfig();

ipcMain.handle('get-sources', () => {
    return SOURCE_URLS;
});


const { dialog } = require('electron');

ipcMain.handle('dialog-open-file', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
        properties: ['openFile'],
        filters: [{ name: 'JSON Files', extensions: ['json'] }]
    });
    if (canceled) return [];
    return filePaths;
});

const fetchJsonViaWindow = (url) => {
    return new Promise((resolve, reject) => {
        const win = new BrowserWindow({
            show: false,
            webPreferences: {
                nodeIntegration: false,
                contextIsolation: true
            }
        });

        let timeout = setTimeout(() => {
            win.destroy();
            reject(new Error("Timeout esperando al servidor (o Cloudflare bloqueando)."));
        }, 15000);

        win.webContents.on('did-finish-load', async () => {
            try {
                const content = await win.webContents.executeJavaScript('document.body.innerText');
                if (content && (content.trim().startsWith('{') || content.trim().startsWith('['))) {
                    const data = JSON.parse(content);
                    clearTimeout(timeout);
                    win.destroy();
                    resolve(data);
                }
            } catch(e) {
                // Ignore, might be cloudflare challenging
            }
        });

        win.loadURL(url);
    });
};

async function getJSONFromSource(url) {
    if (fs.existsSync(url)) {
        return JSON.parse(fs.readFileSync(url, 'utf8'));
    }
    if (url.startsWith('http')) {
        try {
            // First try simple axios
            const resp = await axios.get(url, { timeout: 8000, headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' } });
            return resp.data;
        } catch (err) {
            // If it fails with 403 or timeout, use BrowserWindow
            if (err.response && err.response.status === 403 || err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT') {
                log.info(`Axios failed for ${url}, trying BrowserWindow bypass...`);
                return await fetchJsonViaWindow(url);
            }
            throw err;
        }
    }
    throw new Error("Ruta o URL no válida");
}

ipcMain.handle('add-source', async (event, url) => {
    if (!url || typeof url !== 'string') throw new Error("URL inválida");
    if (SOURCE_URLS.includes(url)) throw new Error("La fuente ya existe");

    // Quick validate
    const data = await getJSONFromSource(url);
    if (!data) throw new Error("El JSON devolvió una respuesta vacía");

    SOURCE_URLS.push(url);
    saveConfig(SOURCE_URLS);
    syncSources(); // Trigger async sync
    return SOURCE_URLS;
});

ipcMain.handle('remove-source', async (event, url) => {
    SOURCE_URLS = SOURCE_URLS.filter(u => u !== url);
    saveConfig(SOURCE_URLS);
    titleIndex.clear();
    cachedDownloads = [];
    syncSources(); // Resync everything
    return SOURCE_URLS;
});

function getPluginDir() {
    const appData = process.env.APPDATA || (process.platform === 'darwin' ? path.join(process.env.HOME, 'Library', 'Application Support') : path.join(process.env.HOME, '.local', 'share'));
    const pluginDir = path.join(appData, 'GameAccess', 'plugins');
    if (!fs.existsSync(pluginDir)) fs.mkdirSync(pluginDir, { recursive: true });
    return pluginDir;
}

function registerPlugin() {
    const manifestPath = path.join(getPluginDir(), 'torrent_provider.json');
    const manifest = {
        id: "ga-torrent-provider",
        name: "Torrent Source Provider",
        type: "source_provider",
        endpoint: `http://127.0.0.1:${PORT}`
    };
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    return manifestPath;
}

function unregisterPlugin(manifestPath) {
    if (fs.existsSync(manifestPath)) fs.unlinkSync(manifestPath);
}

async function syncSources() {
    if (isSyncing) return;
    isSyncing = true;
    log.info("Sincronizando fuentes comunitarias...");
    let allDownloads = [];
    let failedSources = 0;

    for (const url of SOURCE_URLS) {
        try {
            log.info(`Descargando: ${url}`);
            let rawData;
            const { readFeedCache, writeFeedCache } = require('./feed-cache');
            const cacheDir = path.join(app.getPath('userData'), 'source-cache');
            try {
                rawData = await getJSONFromSource(url);
                if (!rawData || typeof rawData !== 'object') throw new Error('La fuente no devolvió un catálogo JSON.');
                writeFeedCache(cacheDir, url, rawData);
            } catch (error) {
                failedSources++;
                rawData = readFeedCache(cacheDir, url);
                if (!rawData) { error.countedFeedFailure = true; throw error; }
                log.warn('[Sources] Feed refresh failed; retaining last valid plugin cache: ' + url);
            }

            let rawList = [];
            if (rawData.downloads && Array.isArray(rawData.downloads)) rawList = rawData.downloads;
            else if (rawData.items && Array.isArray(rawData.items)) rawList = rawData.items;
            else if (Array.isArray(rawData)) rawList = rawData;

            for (const item of rawList) {
                const title = item.title || item.name || "";
                if (!title) continue;

                let uris = item.uris || item.urls || [];
                if (typeof uris === 'string') uris = [uris];
                if (!uris.length && item.uri) uris = [item.uri];
                if (!uris.length && item.url) uris = [item.url];

                const validUris = uris.filter(u => typeof u === 'string' && u.trim() !== '');
                if (!validUris.length) continue;

                allDownloads.push({
                    raw_title: title.trim(),
                    uri: validUris[0],
                    uris: validUris,
                    file_size: item.fileSize || item.file_size || item.size || "Desconocido",
                    upload_date: item.uploadDate || item.date || "",
                    source_url: url,
                    source_name: typeof rawData.name === "string" ? rawData.name : path.basename(url).replace(/\.json$/, "")
                });
            }
        } catch (e) {
            if (!e.countedFeedFailure) failedSources++;
            log.error(`Error sincronizando ${url}:`, e.message);
        }
    }

    cachedDownloads = allDownloads;
    downloadOptions = new Map(optionsFor(allDownloads, '', () => 1).map(item => [item.id, item]));
    const { cleanTitle } = require('./matcher');
    const newIndex = new Map();
    for (const item of allDownloads) {
        const clean = cleanTitle(item.raw_title);
        newIndex.set(clean, (newIndex.get(clean) || 0) + 1);
    }
    titleIndex = newIndex;
    isSyncing = false;
    clearTimeout(retrySyncTimer);
    if (failedSources) retrySyncTimer = setTimeout(syncSources, 60000);
    log.info(`Sincronización completa. Fuentes en caché: ${cachedDownloads.length}`);
}

// Run the host's own WT generator inside Electron's isolated renderer.
const websiteTokens = new Map();
async function websiteToken(account) {
    const cached = websiteTokens.get(account);
    if (cached && cached.expires > Date.now()) return cached.value;
    const win = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true } });
    win.webContents.setUserAgent(USER_AGENT);
    let timer;
    try {
        return await Promise.race([
            (async () => {
                await win.loadURL('https://gofile.io/');
                const value = await win.webContents.executeJavaScript(
                    '(async () => { if (typeof generateWT !== "function") throw new Error("Gofile token generator unavailable"); return await generateWT(' + JSON.stringify(account) + '); })()'
                );
                if (typeof value !== 'string' || !value) throw new Error('Gofile token generator returned no token.');
                websiteTokens.set(account, { value, expires: Date.now() + 60000 });
                return value;
            })(),
            new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Gofile no respondió al preparar la descarga.')), 15000); })
        ]);
    } finally { clearTimeout(timer); if (!win.isDestroyed()) win.destroy(); }
}

function startApiServer() {
    const expressApp = express();
    expressApp.use(cors());
    expressApp.use(express.json({ limit: "50mb" }));
    const resolver = createResolver({ http: axios, websiteToken, log });
    const findOption = id => downloadOptions.get(id);

    expressApp.post('/api/bulk_check', (req, res) => {
        const results = {};
        for (const game of req.body.games || []) {
            if (!game.name) continue;
            const options = optionsFor(cachedDownloads, game.name, calculateScore);
            if (options.length) results[game.id || game.app_id] = req.body.include_sources
                ? { count: options.length, sources: [...new Set(options.map(item => item.source_name))] } : options.length;
        }
        res.json(results);
    });
    expressApp.get('/api/sources', (req, res) => {
        const options = req.query.name ? optionsFor(cachedDownloads, req.query.name, calculateScore) : [];
        log.info('[Sources] AppID=' + req.query.app_id + '; matched download options=' + options.length);
        res.json(options.map(item => ({
            title: item.raw_title, url: item.uri, type: item.uri.startsWith('magnet:') || /\.torrent(?:$|\?)/i.test(item.uri) ? 'torrent' : 'http',
            size: item.file_size, score: item.score, sourceName: item.source_name,
            delivery: hoster(item.uri) === 'browser' ? 'browser' : 'download',
            resolverUrl: 'http://127.0.0.1:' + PORT + '/api/prepare/' + item.id
        })));
    });
    expressApp.get('/api/prepare/:id', async (req, res) => {
        const item = findOption(req.params.id);
        if (!item) return res.status(404).json({ error: 'Esta fuente ya no está disponible; actualiza las fuentes del juego.' });
        try {
            log.info('[Sources] Preparing selected option; provider=' + item.source_name + '; title=' + item.raw_title);
            const file = await resolver.prepare(item.uri);
            const url = file.mode === 'proxy'
                ? 'http://127.0.0.1:' + PORT + '/api/download/' + item.id + '/' + encodeURIComponent(file.name)
                : file.url;
            res.json({ url, mode: file.mode, size: item.file_size });
        } catch (error) {
            log.warn('[Sources] Selected option resolution failed: ' + error.message);
            res.status(422).json({ error: error.message });
        }
    });
    async function proxyFile(uri, req, res) {
        try {
            const file = await resolver.prepare(uri);
            if (file.mode !== 'proxy') return res.status(422).json({ error: 'Esta fuente requiere descarga en el navegador; todavía no hay desbloqueo PLUS para este host.' });
            const headers = { ...file.headers, 'Accept-Encoding': 'identity' };
            if (req.headers.range) headers.Range = req.headers.range;
            const upstream = await axios({ method: req.method === 'HEAD' ? 'HEAD' : 'GET', url: file.url, headers, responseType: 'stream', timeout: 30000 });
            try { assertFileHeaders(upstream.headers); } catch (error) { upstream.data?.destroy?.(); throw error; }
            res.status(upstream.status);
            for (const name of ['content-type', 'content-length', 'content-range', 'accept-ranges']) {
                if (upstream.headers[name]) res.setHeader(name, upstream.headers[name]);
            }
            res.setHeader('Content-Disposition', "attachment; filename*=UTF-8''" + encodeURIComponent(path.basename(file.name)));
            if (req.method === 'HEAD') { upstream.data?.destroy?.(); return res.end(); }
            req.on('aborted', () => upstream.data.destroy());
            res.on('close', () => { if (!res.writableFinished) upstream.data.destroy(); });
            upstream.data.on('error', () => res.destroy());
            upstream.data.pipe(res);
        } catch (error) {
            log.warn('[Sources] Download link processing failed: ' + error.message);
            if (!res.headersSent) res.status(422).json({ error: error.message });
            else res.destroy();
        }
    }
    expressApp.get('/api/download/:id/:name', async (req, res) => {
        const item = findOption(req.params.id);
        if (!item) return res.status(404).json({ error: 'Fuente no disponible.' });
        await proxyFile(item.uri, req, res);
    });
    // Legacy clients receive a file or an explicit failure, never a landing-page redirect.
    expressApp.get('/api/resolve', async (req, res) => {
        const uri = req.query.url;
        const known = cachedDownloads.some(item => (item.uris || [item.uri]).includes(uri));
        if (!known) return res.status(404).json({ error: 'Fuente no disponible.' });
        await proxyFile(uri, req, res);
    });
    server = expressApp.listen(PORT, '127.0.0.1', () => log.info('Plugin API listening on 127.0.0.1:' + PORT));
    syncSources();
    setInterval(syncSources, 30 * 60 * 1000);
}

let manifestPath;

app.whenReady().then(() => {
    startApiServer();
    manifestPath = registerPlugin();

    const win = new BrowserWindow({
        width: 800,
        height: 600,
        autoHideMenuBar: true,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    });
    win.loadFile('index.html');
});

app.on('will-quit', () => {
    if (manifestPath) unregisterPlugin(manifestPath);
    if (server) server.close();
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});
