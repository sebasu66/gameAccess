const fs = require('fs');
let content = fs.readFileSync('apps/desktop/src/librarySearch.ts', 'utf8');

content = content.replace(
  'if (feature === "lan") return lan;',
  'if (feature === "has_downloads") return (game as any).has_downloads === true;\n    if (feature === "lan") return lan;'
);

fs.writeFileSync('apps/desktop/src/librarySearch.ts', content);
console.log('librarySearch updated');
