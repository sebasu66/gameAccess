const fs = require('fs');
let content = fs.readFileSync('apps/desktop/src/App.tsx', 'utf8');

// Update the useEffect in App.tsx
const oldEffect = `  useEffect(() => {
    if (getCatalogMode() !== "digital" || games.length === 0) return;
    digitalCatalogService.bulkCheckSources(games).then(setAvailableSources);
  }, [games]);`;

const newEffect = `  useEffect(() => {
    if (getCatalogMode() !== "digital" || games.length === 0) return;
    digitalCatalogService.bulkCheckSources(games).then(src => {
      // Mutate catalog objects in place to allow fast search filtering
      for (const game of games) {
        (game as any).has_downloads = (src[game.app_id ?? game.id] || 0) > 0;
      }
      setAvailableSources(src);
    });
  }, [games]);`;

content = content.replace(oldEffect, newEffect);

fs.writeFileSync('apps/desktop/src/App.tsx', content);
console.log('App.tsx mutated games');
