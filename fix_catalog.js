const fs = require('fs');
let content = fs.readFileSync('apps/desktop/src/catalog/DigitalCatalog.ts', 'utf8');

const injection = `
export interface PluginSource {
  title: string;
  url: string;
  type: string;
  size: string;
  score: number;
  pluginName?: string;
}
`;

content = content.replace('export interface PluginManifest {', injection + '\nexport interface PluginManifest {');
fs.writeFileSync('apps/desktop/src/catalog/DigitalCatalog.ts', content);
