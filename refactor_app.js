const fs = require('fs');
let content = fs.readFileSync('apps/desktop/src/App.tsx', 'utf8');

// 1. Add state
const stateInjection = `  const [availableSources, setAvailableSources] = useState<Record<number, number>>({});\n  const [query, setQuery] = useState("");`;
content = content.replace('  const [query, setQuery] = useState("");', stateInjection);

// 2. Add useEffect for bulk check
const effectInjection = `  useEffect(() => {
    if (getCatalogMode() !== "digital" || games.length === 0) return;
    digitalCatalogService.bulkCheckSources(games).then(setAvailableSources);
  }, [games]);

  useEffect(() => {`;
content = content.replace('  useEffect(() => {', effectInjection);

// 3. Pass availableSourceCount to DetailPanel
content = content.replace(
  'onDownload={startDownload} busy={leaseBusy} overLibrary={libraryOpen} /> : null}',
  'onDownload={startDownload} busy={leaseBusy} overLibrary={libraryOpen} availableSourceCount={selected.app_id ? availableSources[selected.app_id] : 0} /> : null}'
);

fs.writeFileSync('apps/desktop/src/App.tsx', content);
console.log('App.tsx updated');
