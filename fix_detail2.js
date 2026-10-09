const fs = require('fs');
let content = fs.readFileSync('apps/desktop/src/AppDetailPanel.tsx', 'utf8');

const regex = /  useEffect\(\(\) => \{\n    let active = true;\n    void digitalCatalogService\.hasSources\(game\)\.then\(\(ok\) => \{\n      if \(active\) setHasSources\(ok\);\n    \}\);\n    return \(\) => \{ active = false; \};\n  \}, \[game\]\);\n/g;

content = content.replace(regex, '');
fs.writeFileSync('apps/desktop/src/AppDetailPanel.tsx', content);
