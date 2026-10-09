const fs = require('fs');
let content = fs.readFileSync('apps/desktop/src/App.tsx', 'utf8');

content = content.replace(
  'const startDownload = async (game: CatalogGame, recovery?: { providerId?: string | null; libraryIndex?: number | null }) => {',
  'const startDownload = async (game: CatalogGame, recovery?: { providerId?: string | null; libraryIndex?: number | null; sourceUrl?: string }) => {'
);

content = content.replace(
  'await digitalCatalogService.download(game);',
  'await digitalCatalogService.download(game, recovery?.sourceUrl);'
);

fs.writeFileSync('apps/desktop/src/App.tsx', content);
