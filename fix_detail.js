const fs = require('fs');
let content = fs.readFileSync('apps/desktop/src/AppDetailPanel.tsx', 'utf8');

const target = `  useEffect(() => {
    let active = true;
    void digitalCatalogService.hasSources(game).then((ok) => {
      if (active) setHasSources(ok);
    });
    return () => { active = false; };
  }, [game]);`;

content = content.replace(target, '');
content = content.replace('const [hasSources, setHasSources] = useState<boolean>(true);', '');

fs.writeFileSync('apps/desktop/src/AppDetailPanel.tsx', content);
console.log('AppDetailPanel fixed');
