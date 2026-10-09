const fs = require('fs');
let content = fs.readFileSync('apps/desktop/src/AppDetailPanel.tsx', 'utf8');

// Replace hasSources state with sources array
content = content.replace(
  'const [hasSources, setHasSources] = useState<boolean>(true);',
  'const [sources, setSources] = useState<any[]>([]);\n  const [checkingSources, setCheckingSources] = useState(true);'
);

// Replace useEffect
content = content.replace(
  `  useEffect(() => {
    let active = true;
    void digitalCatalogService.hasSources(game).then((ok) => {
      if (active) setHasSources(ok);
    });
    return () => { active = false; };
  }, [game]);`,
  `  useEffect(() => {
    let active = true;
    setCheckingSources(true);
    void digitalCatalogService.getSources(game).then((srcs) => {
      if (active) {
        setSources(srcs);
        setCheckingSources(false);
      }
    }).catch(() => {
      if (active) setCheckingSources(false);
    });
    return () => { active = false; };
  }, [game]);`
);

// We need to replace the Button label and disabled props
// Old: label={!hasSources && !localState.installed ? "Fuentes no disponibles" : downloadActionLabel(localState, download)}
// Old: tone="download" disabled={(!game.app_id && !game.id) || downloadBlocked || (!hasSources && !localState.installed)}

const oldLabel = `label={!hasSources && !localState.installed ? "Fuentes no disponibles" : downloadActionLabel(localState, download)}`;
const newLabel = `label={checkingSources ? "Buscando fuentes..." : (sources.length === 0 && !localState.installed ? "Fuentes no disponibles" : (downloadActionLabel(localState, download) + (sources.length > 0 && !localState.installed && !localState.transferActive ? \` (\${sources.length})\` : "")))}`;

const oldDisabled = `tone="download" disabled={(!game.app_id && !game.id) || downloadBlocked || (!hasSources && !localState.installed)}`;
const newDisabled = `tone="download" disabled={(!game.app_id && !game.id) || downloadBlocked || checkingSources || (sources.length === 0 && !localState.installed)}`;

content = content.replace(oldLabel, newLabel);
content = content.replace(oldDisabled, newDisabled);

fs.writeFileSync('apps/desktop/src/AppDetailPanel.tsx', content);
console.log('AppDetailPanel updated');
