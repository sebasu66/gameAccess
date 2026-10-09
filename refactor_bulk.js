const fs = require('fs');
let content = fs.readFileSync('apps/desktop/src/catalog/DigitalCatalog.ts', 'utf8');

const injection = `  async bulkCheckSources(games: CatalogGame[]): Promise<Record<number, number>> {
    const results: Record<number, number> = {};
    
    // Check local fixed overrides first
    for (const game of games) {
      const record = this.getRecord(game.id) || this.getRecord(game.app_id ?? 0);
      const downloadSource = (record?.downloadSource ?? (game as any).downloadSource ?? (game as any).download_source ?? "").trim();
      if (downloadSource && downloadSource !== "auto" && !downloadSource.includes("127.0.0.1")) {
         results[game.app_id ?? game.id] = 1;
      }
    }

    try {
      const plugins = await invoke<PluginManifest[]>("get_registered_plugins");
      
      const payload = games.map(g => ({ id: g.app_id ?? g.id, name: g.name }));
      
      const promises = plugins.map(async (plugin) => {
        if (plugin.type === "source_provider") {
          try {
            const res = await fetch(\`\${plugin.endpoint}/api/bulk_check\`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ games: payload }),
              signal: AbortSignal.timeout(5000)
            });
            if (res.ok) {
              const pluginResults = await res.json() as Record<number, number>;
              for (const [appId, count] of Object.entries(pluginResults)) {
                results[Number(appId)] = (results[Number(appId)] || 0) + count;
              }
            }
          } catch (err) {
            console.warn(\`[DigitalCatalog:bulkCheckSources] Plugin \${plugin.name} error:\`, err);
          }
        }
      });
      await Promise.all(promises);
    } catch (e) {
      console.warn("[DigitalCatalog:bulkCheckSources] Failed to check plugins", e);
    }
    
    return results;
  }

  async getSources(game: CatalogGame) {`;

content = content.replace('  async getSources(game: CatalogGame) {', injection);
fs.writeFileSync('apps/desktop/src/catalog/DigitalCatalog.ts', content);
console.log('DigitalCatalog updated with bulkCheckSources');
