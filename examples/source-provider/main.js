const { app, BrowserWindow, ipcMain } = require('electron');
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const http = require('node:http');
const crypto = require('node:crypto');
const { SourceState } = require('./source-state');
const { recoverOrphans, listenAvailable, removeOwnedFile } = require('./instance');
const log = require('electron-log');
const { calculateScore } = require('./matcher');
const { USER_AGENT, hoster, optionsFor, assertFileHeaders, createResolver } = require('./links');

log.transports.file.level = 'info';

let server;
let PORT = 45000;
const instanceId = crypto.randomUUID();
let ownsInstanceLock = app.requestSingleInstanceLock();
let mainWindow;
let refreshTimer;
const sourceState = new SourceState();
const watchedSourceFiles = new Map();
function markSourceDirty(reason) {
    sourceState.markDirty();
    log.info('[Sources] Catalog marked outdated: ' + reason + '; revision=' + sourceState.revision);
}
app.on('second-instance', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.show();
        mainWindow.focus();
    }
});
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
    markSourceDirty('feed added');
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
        instanceId,
        pid: process.pid,
        endpoint: `http://127.0.0.1:${PORT}`
    };
    const temporary = manifestPath + '.tmp';
    fs.writeFileSync(temporary, JSON.stringify(manifest, null, 2));
    fs.renameSync(temporary, manifestPath);
    return manifestPath;
}

function unregisterPlugin(manifestPath) {
    removeOwnedFile(manifestPath, instanceId);
}

function updateSourceFileWatchers() {
    for (const [file, listener] of watchedSourceFiles) {
        if (!SOURCE_URLS.includes(file)) { fs.unwatchFile(file, listener); watchedSourceFiles.delete(file); }
    }
    for (const file of SOURCE_URLS) {
        if (/^https?:\/\//i.test(file) || watchedSourceFiles.has(file)) continue;
        const listener = (current, previous) => {
            if (current.mtimeMs === previous.mtimeMs && current.size === previous.size) return;
            markSourceDirty('configured JSON file changed');
            void syncSources();
        };
        watchedSourceFiles.set(file, listener);
        fs.watchFile(file, { interval: 2000, persistent: false }, listener);
    }
}

async function syncSources() {
    if (isSyncing) return;
    const configVersion = sourceState.configVersion;
    const configuredUrls = [...SOURCE_URLS];
    updateSourceFileWatchers();
    isSyncing = true;
    log.info("Sincronizando fuentes comunitarias...");
    let allDownloads = [];
    let failedSources = 0;

    for (const url of configuredUrls) {
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

    if (configVersion !== sourceState.configVersion) {
        isSyncing = false;
        log.info('[Sources] Configuration changed during refresh; discarding old result and resyncing.');
        void syncSources();
        return;
    }
    sourceState.accept(allDownloads, failedSources > 0);
    log.info('[Sources] Catalog revision=' + sourceState.revision + '; outdated=' + sourceState.dirty);
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

async function startApiServer() {
    const expressApp = express();
    expressApp.use(cors());
    expressApp.use(express.json({ limit: "50mb" }));
    expressApp.get('/api/health', (req, res) => {
        res.setHeader('Cache-Control', 'no-store');
        res.json({ id: 'ga-torrent-provider', instanceId, pid: process.pid, revision: sourceState.revision,
            dirty: sourceState.dirty, syncing: isSyncing, updatedAt: sourceState.updatedAt,
            sourceCount: cachedDownloads.length, windowOpen: Boolean(mainWindow && !mainWindow.isDestroyed()) });
    });
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
    let previousPort;
    try { previousPort = JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'provider-port.json'), 'utf8')).port; } catch {}
    server = await listenAvailable(() => http.createServer(expressApp), 45000, previousPort, log);
    PORT = server.address().port;
    fs.writeFileSync(path.join(app.getPath('userData'), 'provider-port.json'), JSON.stringify({ port: PORT }));
    server.on('error', error => log.error('[Startup] API server error: ' + error.message));
    fs.writeFileSync(path.join(app.getPath('userData'), 'provider-runtime.json'),
        JSON.stringify({ instanceId, pid: process.pid, port: PORT }));
    log.info('[Startup] Plugin API listening on 127.0.0.1:' + PORT);

}

let manifestPath;

app.whenReady().then(async () => {
    await recoverOrphans({ app, log });
    if (!ownsInstanceLock) ownsInstanceLock = app.requestSingleInstanceLock();
    if (!ownsInstanceLock) {
        log.info('[Startup] Existing plugin instance reused; duplicate launch exits.');
        app.exit(0);
        return;
    }
    await startApiServer();
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
    mainWindow = win;
    win.on('closed', () => { mainWindow = null; app.quit(); });
    await win.loadFile(path.join(__dirname, 'index.html'));
    void syncSources();
    refreshTimer = setInterval(syncSources, 30 * 60 * 1000);
}).catch(error => {
    log.error('[Startup] Plugin initialization failed: ' + error.message);
    dialog.showErrorBox('Game Access · Plugin', 'No se pudo iniciar el plugin. Revisa su registro para más detalles.');
    app.exit(1);
});

app.on('will-quit', () => {
    clearTimeout(retrySyncTimer);
    clearInterval(refreshTimer);
    for (const [file, listener] of watchedSourceFiles) fs.unwatchFile(file, listener);
    removeOwnedFile(path.join(app.getPath('userData'), 'provider-runtime.json'), instanceId);
    if (manifestPath) unregisterPlugin(manifestPath);
    if (server) server.close();
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});
