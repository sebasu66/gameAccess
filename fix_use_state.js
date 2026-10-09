const fs = require('fs');
let content = fs.readFileSync('apps/desktop/src/LibraryDetailPanel.tsx', 'utf8');
content = content.replace('import { useState } from "react";\r\n', '');
content = content.replace('import { useState } from "react";\n', '');
fs.writeFileSync('apps/desktop/src/LibraryDetailPanel.tsx', content);
