const fs = require('fs');
let content = fs.readFileSync('apps/desktop/src/AppDetailPanel.tsx', 'utf8');

// 1. Add state and imports
content = content.replace(
  'const [optionsOpen, setOptionsOpen] = useState(false);',
  `const [optionsOpen, setOptionsOpen] = useState(false);
  const [showSourceSelector, setShowSourceSelector] = useState(false);
  const [sources, setSources] = useState<any[]>([]);
  const [loadingSources, setLoadingSources] = useState(false);`
);

// 2. Add source fetching logic
const fetchLogic = `  const handleDownloadClick = () => {
    if (availableSourceCount > 0 && !localState.installed && !localState.transferActive) {
      setShowSourceSelector(true);
      setLoadingSources(true);
      digitalCatalogService.getSources(game).then(srcs => {
        setSources(srcs);
        setLoadingSources(false);
      });
    } else {
      void onDownload(game);
    }
  };`;
content = content.replace('  const closeWithAnimation = useCallback', fetchLogic + '\n\n  const closeWithAnimation = useCallback');

// 3. Update the Download button onClick
content = content.replace(
  'onClick={() => void onDownload(game)}',
  'onClick={handleDownloadClick}'
);

// 4. Inject the Source Selector UI
const actionUI = `              <GlassActionButton
                icon={activeDownload ? <Loader2 size={23} className="spin" /> : <Download size={24} />}
                label={availableSourceCount === 0 && !localState.installed ? "Fuentes no disponibles" : (downloadActionLabel(localState, download) + (availableSourceCount > 0 && !localState.installed && !localState.transferActive && !showSourceSelector ? \` (\${availableSourceCount} fuentes)\` : ""))}
                tone="download" disabled={(!game.app_id && !game.id) || downloadBlocked || (availableSourceCount === 0 && !localState.installed)}
                onClick={handleDownloadClick}
              />
            </div>
            
            {showSourceSelector && !localState.installed && !localState.transferActive ? (
              <div className="source-selector-panel" style={{ marginTop: "14px", padding: "16px", background: "rgba(0,0,0,0.4)", borderRadius: "12px", border: "1px solid rgba(255,255,255,0.05)" }}>
                <h4 style={{ margin: "0 0 12px 0", fontSize: "14px", color: "#fff", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span>Elige una versión</span>
                  <button onClick={() => setShowSourceSelector(false)} style={{ background: "none", border: "none", color: "#888", cursor: "pointer", padding: "4px" }}><X size={16} /></button>
                </h4>
                {loadingSources ? (
                  <div style={{ display: "flex", gap: "8px", alignItems: "center", color: "#888", fontSize: "12px" }}>
                    <Loader2 size={16} className="spin" /> Buscando opciones...
                  </div>
                ) : sources.length > 0 ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                    <div className="best-source" style={{ background: "rgba(255,106,0,0.1)", padding: "12px", borderRadius: "8px", border: "1px solid rgba(255,106,0,0.3)" }}>
                      <p style={{ margin: "0 0 8px 0", fontSize: "13px", color: "#ff8c3a", fontWeight: "bold" }}>Recomendada (Mejor conectividad)</p>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <div style={{ flex: 1, overflow: "hidden" }}>
                          <div style={{ fontSize: "14px", color: "#fff", whiteSpace: "nowrap", textOverflow: "ellipsis", overflow: "hidden" }}>{sources[0].title}</div>
                          <div style={{ fontSize: "11px", color: "#aaa", marginTop: "2px" }}>{sources[0].size} • {sources[0].pluginName}</div>
                        </div>
                        <button onClick={() => onDownload(game, sources[0].url)} style={{ background: "#ff6a00", color: "#111", border: "none", padding: "8px 16px", borderRadius: "20px", fontWeight: "bold", cursor: "pointer", fontSize: "12px", marginLeft: "12px" }}>Descargar</button>
                      </div>
                    </div>
                    
                    {sources.length > 1 && (
                      <details style={{ fontSize: "12px", color: "#bbb" }}>
                        <summary style={{ cursor: "pointer", padding: "4px 0" }}>Ver otras {sources.length - 1} alternativas</summary>
                        <div style={{ marginTop: "8px", display: "flex", flexDirection: "column", gap: "8px" }}>
                          {sources.slice(1).map((s, i) => (
                            <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px", background: "rgba(255,255,255,0.03)", borderRadius: "6px" }}>
                               <div style={{ flex: 1, overflow: "hidden", marginRight: "12px" }}>
                                 <div style={{ color: "#ddd", whiteSpace: "nowrap", textOverflow: "ellipsis", overflow: "hidden" }}>{s.title}</div>
                                 <div style={{ fontSize: "10px", color: "#888", marginTop: "2px" }}>{s.size} • {s.pluginName}</div>
                               </div>
                               <button onClick={() => onDownload(game, s.url)} style={{ background: "rgba(255,255,255,0.1)", color: "#fff", border: "none", padding: "4px 12px", borderRadius: "12px", cursor: "pointer", fontSize: "11px" }}>Bajar</button>
                            </div>
                          ))}
                        </div>
                      </details>
                    )}
                  </div>
                ) : (
                  <p style={{ color: "#888", fontSize: "12px" }}>No se encontraron fuentes estables.</p>
                )}
              </div>
            ) : null}`;

// The old button UI
const oldActionUI = `              <GlassActionButton
                icon={activeDownload ? <Loader2 size={23} className="spin" /> : <Download size={24} />}
                label={availableSourceCount === 0 && !localState.installed ? "Fuentes no disponibles" : (downloadActionLabel(localState, download) + (availableSourceCount > 0 && !localState.installed && !localState.transferActive ? \` (\${availableSourceCount} fuentes)\` : ""))}
                tone="download" disabled={(!game.app_id && !game.id) || downloadBlocked || (availableSourceCount === 0 && !localState.installed)}
                onClick={() => void onDownload(game)}
              />
            </div>`;

content = content.replace(oldActionUI, actionUI);

// Fix TS errors related to "any" inside the script if there are any, we used <any[]> so it's fine.
fs.writeFileSync('apps/desktop/src/AppDetailPanel.tsx', content);
console.log('AppDetailPanel UI refactored');
