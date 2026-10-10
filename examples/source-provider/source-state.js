const crypto = require('node:crypto');
class SourceState {
  constructor() { this.revision = 0; this.configVersion = 0; this.dirty = true; this.digest = ''; this.updatedAt = null; }
  markDirty() { this.dirty = true; this.configVersion++; this.revision++; }
  accept(items, failed = false) {
    const digest = crypto.createHash('sha256').update(JSON.stringify(items)).digest('hex');
    if (digest !== this.digest) { this.digest = digest; this.revision++; }
    this.dirty = failed;
    this.updatedAt = new Date().toISOString();
  }
}
module.exports = { SourceState };
