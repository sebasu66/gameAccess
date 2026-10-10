const fs = require('fs');
let content = fs.readFileSync('apps/desktop/src/librarySearch.ts', 'utf8');

content = content.replace(
  '["shared_split_screen", "cross_platform", "mmo"]',
  '["shared_split_screen", "cross_platform", "mmo", "has_downloads"]'
);

fs.writeFileSync('apps/desktop/src/librarySearch.ts', content);
