const fs = require('fs');
let content = fs.readFileSync('apps/desktop/src/LibraryDetailPanel.tsx', 'utf8');

// Strip the bad imports I just tried to fix
content = content.replace('import { digitalDownloadService as digitalCatalogService } from "./catalog/DigitalCatalog";', '');
content = content.replace('import { getCatalogMode } from "./catalogMode";\nimport { useState } from "react";\n', '');
content = content.replace('import { digitalCatalogService } from "./catalog/DigitalCatalogService";', '');

// Strip the original duplicates if any
content = content.replace(/import \{ getCatalogMode \} from "\.\/catalogMode";\r?\n/g, '');

// Now cleanly add them at the top
const importsToAdd = `
import { digitalCatalogService } from "./catalog/DigitalCatalog";
import { getCatalogMode } from "./catalogMode";
`;

content = content.replace('import {downloadButtonLabel} from "./downloadSize";', 'import {downloadButtonLabel} from "./downloadSize";' + importsToAdd);

fs.writeFileSync('apps/desktop/src/LibraryDetailPanel.tsx', content);
