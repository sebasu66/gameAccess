const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const fileFor = (directory, url) => path.join(directory, crypto.createHash('sha256').update(url).digest('hex') + '.json');
function readFeedCache(directory, url) {
  try {
    const record = JSON.parse(fs.readFileSync(fileFor(directory, url), 'utf8'));
    return record.url === url && record.data && typeof record.data === 'object' ? record.data : null;
  } catch { return null; }
}
function writeFeedCache(directory, url, data) {
  const items = Array.isArray(data) ? data : data?.downloads || data?.items;
  if (!Array.isArray(items)) throw new Error('La fuente no contiene una lista de descargas válida.');
  fs.mkdirSync(directory, { recursive: true });
  const file = fileFor(directory, url);
  const temporary = file + '.tmp';
  fs.writeFileSync(temporary, JSON.stringify({ url, data }), 'utf8');
  fs.renameSync(temporary, file);
}
module.exports = { readFeedCache, writeFeedCache };
