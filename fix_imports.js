const fs = require('fs');
let content = fs.readFileSync('apps/desktop/src/LibraryDetailPanel.tsx', 'utf8');

content = content.replace('import { digitalCatalogService } from "./catalog/DigitalCatalogService";', 'import { digitalDownloadService as digitalCatalogService } from "./catalog/DigitalCatalog";');
content = content.replace('import { getCatalogMode } from "./catalogMode";\nimport { useState } from "react";\n', '');

fs.writeFileSync('apps/desktop/src/LibraryDetailPanel.tsx', content);
