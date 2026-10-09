const fs = require('fs');
let content = fs.readFileSync('apps/desktop/src/librarySearch.ts', 'utf8');
content = content.replace('| "cross_platform";', '| "cross_platform"\n  | "has_downloads";');
content = content.replace('{ key: "single_player", label: "Un jugador" },', '{ key: "has_downloads", label: "Descargables (Fuentes disponibles)" },\n  { key: "single_player", label: "Un jugador" },');
fs.writeFileSync('apps/desktop/src/librarySearch.ts', content);
