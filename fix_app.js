const fs = require('fs');
let content = fs.readFileSync('apps/desktop/src/App.tsx', 'utf8');

// The injected block
const blockToRemove = `  useEffect(() => {
    if (getCatalogMode() !== "digital" || games.length === 0) return;
    digitalCatalogService.bulkCheckSources(games).then(src => {
      // Mutate catalog objects in place to allow fast search filtering
      for (const game of games) {
        (game as any).has_downloads = (src[game.app_id ?? game.id] || 0) > 0;
      }
      setAvailableSources(src);
    });
  }, [games]);

`;

// Remove the wrongly placed effect
content = content.replace(blockToRemove, '');

// Place it after const [availableSources...]
const injectionTarget = `  const [availableSources, setAvailableSources] = useState<Record<number, number>>({});`;
content = content.replace(injectionTarget, injectionTarget + '\n\n' + blockToRemove.trim());

fs.writeFileSync('apps/desktop/src/App.tsx', content);
