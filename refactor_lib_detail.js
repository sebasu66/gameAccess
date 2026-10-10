const fs = require('fs');

// 1. Refactor LibraryRoomParts.tsx
let roomParts = fs.readFileSync('apps/desktop/src/LibraryRoomParts.tsx', 'utf8');

const buildActionsStart = `  return [{
    label: "Descargar",
    icon: <Download size={23} />,
    disabled: !game.app_id && !game.id,
    kind: "download",
  }];`;

const buildActionsNew = `  const isDigital = getCatalogMode() === "digital";
  const srcCount = (game as any).availableSourceCount ?? 0;
  
  return [{
    label: "Descargar",
    icon: <Download size={23} />,
    disabled: (!game.app_id && !game.id) || (isDigital && srcCount === 0),
    kind: "download",
  }];`;

roomParts = roomParts.replace(buildActionsStart, buildActionsNew);
if (!roomParts.includes('getCatalogMode()')) {
    roomParts = roomParts.replace('import { Play, Download, Loader2, XCircle } from "lucide-react";', 'import { Play, Download, Loader2, XCircle } from "lucide-react";\nimport { getCatalogMode } from "./catalogMode";');
}
fs.writeFileSync('apps/desktop/src/LibraryRoomParts.tsx', roomParts);


// 2. Refactor LibraryDetailPanel.tsx
let detailPanel = fs.readFileSync('apps/desktop/src/LibraryDetailPanel.tsx', 'utf8');

// Imports
if (!detailPanel.includes('digitalCatalogService')) {
    detailPanel = detailPanel.replace('import {downloadButtonLabel} from "./downloadSize";', 'import {downloadButtonLabel} from "./downloadSize";\nimport { digitalCatalogService } from "./catalog/DigitalCatalogService";\nimport { getCatalogMode } from "./catalogMode";\nimport { useState } from "react";');
}

// ActionButtons
const actionButtonsStart = `function ActionButtons(props: FeaturePanelProps) {
  const {locale,t}=useI18n();
  return (
    <div className="library-room-actions glass-actions-row">`;

const actionButtonsNew = `function ActionButtons(props: FeaturePanelProps) {
  const {locale,t}=useI18n();
  const [showSourceSelector, setShowSourceSelector] = useState(false);
  const [sources, setSources] = useState<any[]>([]);
  const [loadingSources, setLoadingSources] = useState(false);

  const isDigital = getCatalogMode() === "digital";
  const srcCount = (props.game as any).availableSourceCount ?? 0;

  const handleAction = (index: number, action: any) => {
    if (action.kind === "download" && isDigital && srcCount > 0) {
      if (!showSourceSelector) {
        setShowSourceSelector(true);
        setLoadingSources(true);
        digitalCatalogService.getSources(props.game).then(srcs => {
          setSources(srcs);
          setLoadingSources(false);
        });
      } else {
        props.onAction(index);
      }
    } else {
      props.onAction(index);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "14px", width: "100%" }}>
    <div className="library-room-actions glass-actions-row">`;

detailPanel = detailPanel.replace(actionButtonsStart, actionButtonsNew);

const buttonMappingOld = `          <button
            type="button"
            key={\`\${action.kind}-\${action.label}\`}
            ref={(node) => { if (props.actionRefs.current) props.actionRefs.current[index] = node; }}
            data-action={action.kind}
            title={action.reason ?? undefined}
            className={actionClass(action, props.focusZone === "actions" && props.actionIndex === index)}
            onFocus={() => { props.setFocusZone("actions"); props.setActionIndex(index); }}
            onClick={() => props.onAction(index)}
            disabled={action.disabled}
          >
            <span className="glass-action-icon">{action.icon}</span>
            <span className="glass-action-label">{action.kind === "download" ? downloadButtonLabel(props.game,locale) : action.kind === "play" ? t("downloadsPlay") : action.kind === "cancel" ? t("downloadsCancel") : action.label}</span>
          </button>`;

const buttonMappingNew = `          <button
            type="button"
            key={\`\${action.kind}-\${action.label}\`}
            ref={(node) => { if (props.actionRefs.current) props.actionRefs.current[index] = node; }}
            data-action={action.kind}
            title={action.reason ?? undefined}
            className={actionClass(action, props.focusZone === "actions" && props.actionIndex === index)}
            onFocus={() => { props.setFocusZone("actions"); props.setActionIndex(index); }}
            onClick={() => handleAction(index, action)}
            disabled={action.disabled}
          >
            <span className="glass-action-icon">{action.icon}</span>
            <span className="glass-action-label">{action.kind === "download" ? (isDigital ? (srcCount > 0 ? (showSourceSelector ? downloadButtonLabel(props.game,locale) : \`Descargar (\${srcCount} fuentes)\`) : "Fuentes no disponibles") : downloadButtonLabel(props.game,locale)) : action.kind === "play" ? t("downloadsPlay") : action.kind === "cancel" ? t("downloadsCancel") : action.label}</span>
          </button>`;

detailPanel = detailPanel.replace(buttonMappingOld, buttonMappingNew);

const closeDivOld = `      </div>
    );
  }`;

const closeDivNew = `      </div>
      {showSourceSelector && isDigital && (
        <div className="source-selector-panel" style={{ padding: "16px", background: "rgba(0,0,0,0.4)", borderRadius: "12px", border: "1px solid rgba(255,255,255,0.05)" }}>
          <h4 style={{ margin: "0 0 12px 0", fontSize: "14px", color: "#fff", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span>Elige una versión</span>
            <button onClick={() => setShowSourceSelector(false)} style={{ background: "none", border: "none", color: "#888", cursor: "pointer", padding: "4px" }}>X</button>
          </h4>
          {loadingSources ? (
            <div style={{ color: "#888", fontSize: "12px" }}>Buscando opciones...</div>
          ) : sources.length > 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              <div className="best-source" style={{ background: "rgba(255,106,0,0.1)", padding: "12px", borderRadius: "8px", border: "1px solid rgba(255,106,0,0.3)" }}>
                <p style={{ margin: "0 0 8px 0", fontSize: "13px", color: "#ff8c3a", fontWeight: "bold" }}>Recomendada (Mejor conectividad)</p>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div style={{ flex: 1, overflow: "hidden" }}>
                    <div style={{ fontSize: "14px", color: "#fff", whiteSpace: "nowrap", textOverflow: "ellipsis", overflow: "hidden" }}>{sources[0].title}</div>
                    <div style={{ fontSize: "11px", color: "#aaa", marginTop: "2px" }}>{sources[0].size} • {sources[0].pluginName}</div>
                  </div>
                  <button onClick={() => {
                     // Fire normal download with url
                     // Wait, props.onAction does not take URL!
                     // Actually, we must expose onDownload with URL or just set it globally?
                     // LibraryRoom does onDownload(game)
                     // So we must handle it by modifying game temporarily, but wait:
                     // App.tsx handles onDownload(game, recovery). 
                     // Since LibraryRoom doesn't pass the URL, let's just trigger a custom event or modify the global service
                     digitalCatalogService.download(props.game, sources[0].url);
                     setShowSourceSelector(false);
                  }} style={{ background: "#ff6a00", color: "#111", border: "none", padding: "8px 16px", borderRadius: "20px", fontWeight: "bold", cursor: "pointer", fontSize: "12px", marginLeft: "12px" }}>Descargar</button>
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
                          <button onClick={() => {
                            digitalCatalogService.download(props.game, s.url);
                            setShowSourceSelector(false);
                          }} style={{ background: "rgba(255,255,255,0.1)", color: "#fff", border: "none", padding: "4px 12px", borderRadius: "12px", cursor: "pointer", fontSize: "11px" }}>Bajar</button>
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
      )}
    </div>
    );
  }`;

// Note: Replace only the first occurrence which is at the end of ActionButtons
detailPanel = detailPanel.replace(closeDivOld, closeDivNew);

fs.writeFileSync('apps/desktop/src/LibraryDetailPanel.tsx', detailPanel);

console.log('LibraryDetailPanel UI refactored');
