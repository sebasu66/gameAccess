const fs = require('fs');
let content = fs.readFileSync('apps/desktop/src/AppDetailPanel.tsx', 'utf8');

// The code we want to strip starts with "useEffect(() => {" and ends with "}, [game]);"
// But there are multiple useEffects. We only want the one dealing with setCheckingSources.
const lines = content.split('\n');
let newLines = [];
let skip = false;

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  if (line.includes('const [sources, setSources]')) continue;
  if (line.includes('const [checkingSources, setCheckingSources]')) continue;
  
  if (line.includes('useEffect(() => {') && lines[i+2] && lines[i+2].includes('setCheckingSources')) {
    skip = true;
    continue;
  }
  
  if (skip) {
    if (line.includes('}, [game]);')) {
      skip = false;
    }
    continue;
  }
  
  newLines.push(line);
}

content = newLines.join('\n');

content = content.replace(
  /label=\{checkingSources \? "Buscando fuentes\.\.\." : \(sources\.length === 0 && !localState\.installed \? "Fuentes no disponibles" : \(downloadActionLabel\(localState, download\) \+ \(sources\.length > 0 && !localState\.installed && !localState\.transferActive \? \` \(\$\{sources\.length\}\)\` : ""\)\)\)\}/g,
  'label={availableSourceCount === 0 && !localState.installed ? "Fuentes no disponibles" : (downloadActionLabel(localState, download) + (availableSourceCount > 0 && !localState.installed && !localState.transferActive ? ` (${availableSourceCount} fuentes)` : ""))}'
);

content = content.replace(
  /disabled=\{\(!game\.app_id && !game\.id\) \|\| downloadBlocked \|\| checkingSources \|\| \(sources\.length === 0 && !localState\.installed\)\}/g,
  'disabled={(!game.app_id && !game.id) || downloadBlocked || (availableSourceCount === 0 && !localState.installed)}'
);

fs.writeFileSync('apps/desktop/src/AppDetailPanel.tsx', content);
console.log('AppDetailPanel fully refactored');
