const fs = require('fs');
let content = fs.readFileSync('C:\\DEV\\ga-torrent-plugin\\main.js', 'utf8');

// 1. Add express.json() to expressApp
if (!content.includes('expressApp.use(express.json());')) {
    content = content.replace('expressApp.use(cors());', 'expressApp.use(cors());\n    expressApp.use(express.json({ limit: "50mb" }));');
}

// 2. Add titleIndex
if (!content.includes('let titleIndex = new Map();')) {
    content = content.replace('let cachedDownloads = [];', 'let cachedDownloads = [];\nlet titleIndex = new Map();');
}

// 3. Update titleIndex in syncSources
const syncTarget = 'cachedDownloads = allDownloads;';
if (content.includes(syncTarget)) {
    content = content.replace(syncTarget, `cachedDownloads = allDownloads;
    const { cleanTitle } = require('./matcher');
    const newIndex = new Map();
    for (const item of allDownloads) {
        const clean = cleanTitle(item.raw_title);
        newIndex.set(clean, (newIndex.get(clean) || 0) + 1);
    }
    titleIndex = newIndex;`);
}

// 4. Add /api/bulk_check route
const routeTarget = "expressApp.get('/api/sources', (req, res) => {";
if (content.includes(routeTarget)) {
    const bulkCheckCode = `
    expressApp.post('/api/bulk_check', (req, res) => {
        const games = req.body.games || [];
        const { cleanTitle } = require('./matcher');
        const results = {};
        for (const game of games) {
            if (!game.name) continue;
            const clean = cleanTitle(game.name);
            const count = titleIndex.get(clean) || 0;
            if (count > 0) {
                results[game.id || game.app_id] = count;
            }
        }
        res.json(results);
    });\n\n    `;
    content = content.replace(routeTarget, bulkCheckCode + routeTarget);
}

fs.writeFileSync('C:\\DEV\\ga-torrent-plugin\\main.js', content);
console.log('Plugin updated with bulk check');
