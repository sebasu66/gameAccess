const fs = require('fs');
let content = fs.readFileSync('apps/desktop/src/catalog/DigitalCatalog.ts', 'utf8');
const startIdx = content.indexOf('async download(game: CatalogGame): Promise<void> {');
const endIdx = content.indexOf('const effectiveRecord: DigitalGameRecord = {');
if (startIdx !== -1 && endIdx !== -1) {
    const newCode = `async download(game: CatalogGame, sourceUrl?: string): Promise<void> {
    console.log("[DigitalCatalog:download] Starting download for:", { id: game.id, app_id: game.app_id, name: game.name, sourceUrl });
    if (this.options.downloadHandler) {
      console.log("[DigitalCatalog:download] Using custom downloadHandler");
      return this.options.downloadHandler(game);
    }
    const record = this.getRecord(game.id) || this.getRecord(game.app_id ?? 0);
    
    let finalSourceUrl = sourceUrl;
    let autoInstalled = record?.auto_installed ?? (game as any).auto_installed ?? false;

    // Check fixed override
    const fixedOverride = (record?.downloadSource ?? (game as any).downloadSource ?? (game as any).download_source ?? "").trim();
    if (!finalSourceUrl && fixedOverride && fixedOverride !== "auto" && !fixedOverride.includes("127.0.0.1")) {
      finalSourceUrl = fixedOverride;
    }

    if (!finalSourceUrl) {
      const sources = await this.getSources(game);
      if (sources.length > 0) {
        finalSourceUrl = sources[0].url;
        autoInstalled = false;
      }
    }

    if (!finalSourceUrl) {
      throw new Error("No se encontró ninguna fuente de descarga activa para este juego.");
    }

    let downloadSource = finalSourceUrl;

    `;
    content = content.substring(0, startIdx) + newCode + content.substring(endIdx);
    fs.writeFileSync('apps/desktop/src/catalog/DigitalCatalog.ts', content);
    console.log('Replaced successfully');
} else {
    console.log('Indexes not found', startIdx, endIdx);
}
