const fs = require('fs');
let app = fs.readFileSync('apps/desktop/src/App.tsx', 'utf8');

app = app.replace(
  'availableSourceCount={selected.app_id ? availableSources[selected.app_id] : 0}',
  'availableSourceCount={availableSources[selected.app_id ?? selected.id] || 0}'
);

fs.writeFileSync('apps/desktop/src/App.tsx', app);
console.log("DetailPanel prop fixed");
