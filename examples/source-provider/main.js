const { app, BrowserWindow, ipcMain } = require('electron');
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const log = require('electron-log');
const { calculateScore } = require('./matcher');

log.transports.file.level = 'info';

let server;
const PORT = 45000;
let cachedDownloads = [];
let titleIndex = new Map();
let isSyncing = false;



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

    for (const url of SOURCE_URLS) {
        try {
            log.info(`Descargando: ${url}`);
            let rawData = await getJSONFromSource(url);
            
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
            log.error(`Error sincronizando ${url}:`, e.message);
        }
    }

    cachedDownloads = allDownloads;
    const { cleanTitle } = require('./matcher');
    const newIndex = new Map();
    for (const item of allDownloads) {
        const clean = cleanTitle(item.raw_title);
        newIndex.set(clean, (newIndex.get(clean) || 0) + 1);
    }
    titleIndex = newIndex;
    isSyncing = false;
    log.info(`Sincronización completa. Fuentes en caché: ${cachedDownloads.length}`);
}

function startApiServer() {
    const expressApp = express();
    expressApp.use(cors());
    expressApp.use(express.json({ limit: "50mb" }));

    
    expressApp.post('/api/bulk_check', (req, res) => {
        const games = req.body.games || [];
        const { calculateScore } = require('./matcher');
        const results = {};
        for (const game of games) {
            if (!game.name) continue;
            let count = 0;
            const sourceNames = new Set();
            for (const item of cachedDownloads) {
                if (calculateScore(game.name, item.raw_title) >= 0.55) {
                    count++;
                    sourceNames.add(item.source_name);
                }
            }
            if (count > 0) {
                results[game.id || game.app_id] = req.body.include_sources ? { count, sources: [...sourceNames] } : count;
            }
        }
        res.json(results);
    });

    expressApp.get('/api/sources', (req, res) => {
        const appId = req.query.app_id;
        const name = req.query.name;
        
        if (!name) return res.json([]);

        let scored = [];
        for (const item of cachedDownloads) {
            const score = calculateScore(name, item.raw_title);
            if (score >= 0.55) {
                scored.push({ score, item });
            }
        }

        scored.sort((a, b) => b.score - a.score);

        const results = scored.map(s => {
            let finalUrl = s.item.uri;
            if (finalUrl.includes('gofile.io')) {
                finalUrl = `http://127.0.0.1:${PORT}/api/resolve?url=${encodeURIComponent(finalUrl)}`;
            }
            return {
                title: s.item.raw_title,
                url: finalUrl,
                type: s.item.uri.startsWith("magnet") ? "torrent" : "http",
                size: s.item.file_size,
                score: s.score,
                sourceName: s.item.source_name
            };
        });

        res.json(results);
    });

    expressApp.get('/api/resolve', async (req, res) => {
        const url = req.query.url;
        if (!url) return res.status(400).json({ error: "Missing url parameter" });

        if (url.includes('gofile.io')) {
            const { resolveGofile } = require('./gofile');
            const directLink = await resolveGofile(url);
            if (directLink) {
                return res.redirect(302, directLink);
            }
        }
        
        // If it's not a known hoster or resolution failed, just redirect to original
        res.redirect(302, url);
    });

    server = expressApp.listen(PORT, () => {
        log.info(`Plugin API escuchando en http://127.0.0.1:${PORT}`);
    });

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
