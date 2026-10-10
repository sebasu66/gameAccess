// Match game identity before accepting release/version metadata.
// A fuzzy character ratio must never enable a different game's download.
const cache = new Map();
function cleanTitle(title) {
    if (!title || typeof title !== 'string') return '';
    if (cache.has(title)) return cache.get(title);
    const clean = title.normalize('NFKD').replace(/[\u0300-\u036f®™©]/g, '')
        .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .replace(/['’]/g, '').replace(/&/g, ' and ')
        .replace(/[^\p{L}\p{N}]+/gu, ' ').trim().toLowerCase();
    cache.set(title, clean);
    return clean;
}
function calculateScore(gameName, rawTitle) {
    const name = cleanTitle(gameName);
    const title = cleanTitle(rawTitle);
    if (!name || !title) return 0;
    if (name === title) return 1;
    const tokens = title.split(' ');
    const gameTokens = name.split(' ');
    // Optional feed/repacker prefixes are not part of game identity.
    while (['fitgirl', 'dodi', 'repack', 'repacks', 'onlinefix'].includes(tokens[0])) tokens.shift();
    if (!gameTokens.every((token, index) => token === tokens[index])) return 0;
    const rest = tokens.slice(gameTokens.length);
    if (!rest.length) return 0.95;
    const marker = rest[0];
    // Bare sequel numbers and unrelated subtitles cannot be release metadata.
    const release = /^(?:v\d|build|version|ver|free|download|repack|repacks|multi\d|update|all|dlc|deluxe|ultimate|complete|edition|goty|onlinefix|fitgirl|dodi|steamrip|gog|incl|including|with|win|windows)/i;
    const dottedVersion = /^\d+$/.test(marker) && /^\d+$/.test(rest[1] || '') && /\b\d+\.\d+/.test(rawTitle);
    return release.test(marker) || dottedVersion ? 0.9 : 0;
}
module.exports = { cleanTitle, calculateScore };
