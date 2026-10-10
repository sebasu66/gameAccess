const fs = require('fs');
let content = fs.readFileSync('apps/desktop/src/App.tsx', 'utf8');

content = content.replace(
  '(game as any).has_downloads = (src[game.app_id ?? game.id] || 0) > 0;',
  '(game as any).has_downloads = (src[game.app_id ?? game.id] || 0) > 0;\n        (game as any).availableSourceCount = src[game.app_id ?? game.id] || 0;'
);

fs.writeFileSync('apps/desktop/src/App.tsx', content);
