import React from "react";
import ReactDOM from "react-dom/client";
import { isTauri } from "@tauri-apps/api/core";
import App from "./App";
import ActivationGate from "./ActivationGate";
import CatalogTabs from "./CatalogTabs";
import LibraryInputController, { captureLibraryUiState } from "./LibraryInputController";
import RuntimeGate from "./RuntimeGate";
import AppSettings from "./AppSettings";
import BackendStatus from "./BackendStatus";
import AccessPass from "./AccessPass";
import LanguageSwitch from "./LanguageSwitch";
import PixelAppearance from "./PixelAppearance";
import WindowChrome from "./WindowChrome";
import { startLocalAutomation } from "./automation";
import { getCatalogMode, setCatalogMode, type CatalogMode } from "./catalogMode";
import { narrate, startNarrationSession } from "./narrationLog";
import { translate, useI18n } from "./i18n";
import { CATALOG_REFRESH_REQUEST, CATALOG_REFRESH_STATUS } from "./catalogUpdates";
import "./styles.css";
import "./session.css";
import "./experience.css";
import "./polish.css";
import "./library-room.css";
import "./download-manager.css";
import "./bootstrap.css";

import "./catalog-tabs.css";
import "./library-input-controller.css";
import "./catalog-refresh.css";
import "./activation.css";
import "./splash-screen.css";
import "./library-sections.css";
import "./i18n.css";
import "./gameaccess-theme.css";
import "./pixel-appearance.css";

// Suppress WebView's browser menu in the native client. Keep propagation so
// game cards can still open the application's own context menu.
if (isTauri()) {
  const suppressBrowserMenu = (event: MouseEvent) => event.preventDefault();
  document.addEventListener("contextmenu", suppressBrowserMenu, true);
  import.meta.hot?.dispose(() => document.removeEventListener("contextmenu", suppressBrowserMenu, true));
}

// The desktop library currently exposes only Digital. Migrate saved source
// selections so a hidden legacy tab cannot leave the catalog in another mode.
const currentSurface = new URLSearchParams(window.location.search).get("surface");
if (currentSurface !== "display" && currentSurface !== "tablet") setCatalogMode("digital");

class AppCrashBoundary extends React.Component<React.PropsWithChildren, { error: Error | null }> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("gameAccess UI crash", error, info);
    void narrate(`The front end crashed: ${error.message || "unknown UI error"}. React component stack: ${info.componentStack || "unavailable"}`, { area: "ERROR", level: "ERROR" });
  }
  render() {
    if (this.state.error) return <main className="runtime-gate"><section className="runtime-gate-card crash-card"><span className="eyebrow">{translate("crashEyebrow")}</span><h1>{translate("crashTitle")}</h1><p>{this.state.error.message || translate("crashUnexpected")}</p><button type="button" className="primary" onClick={() => window.location.reload()}>{translate("retry")}</button></section></main>;
    return this.props.children;
  }
}

function CatalogShell() {
  const { t } = useI18n();
  const [actionsTarget, setActionsTarget] = React.useState<HTMLDivElement | null>(null);
  const [mode, setMode] = React.useState<CatalogMode>(() => getCatalogMode());
  const [refreshing, setRefreshing] = React.useState(false);
  React.useEffect(() => {
    const status = (event: Event) => setRefreshing((event as CustomEvent<{busy:boolean}>).detail.busy);
    window.addEventListener(CATALOG_REFRESH_STATUS, status);
    return () => window.removeEventListener(CATALOG_REFRESH_STATUS, status);
  }, []);
  const surface = new URLSearchParams(window.location.search).get("surface");
  const auxiliarySurface = surface === "tablet" || surface === "display";
  const changeMode = React.useCallback((next: CatalogMode) => {
    if (next === mode) return;
    if (!auxiliarySurface) captureLibraryUiState(mode);
    void narrate(`Switching catalog view from ${mode} to ${next}. This changes which availability rules are used.`, { area: "CATALOG" });
    setCatalogMode(next);
    setMode(next);
  }, [auxiliarySurface, mode]);
  const refreshCatalog = React.useCallback(() => {
    if (!auxiliarySurface) captureLibraryUiState(mode);
    void narrate(`Manual catalog refresh requested while viewing ${mode}.`, { area: "CATALOG" });
    window.dispatchEvent(new Event(CATALOG_REFRESH_REQUEST));
  }, [auxiliarySurface, mode]);
  return <>
    {!auxiliarySurface ? <AccessPass /> : null}
    {!auxiliarySurface ? <LibraryInputController mode={mode} onModeChange={changeMode} /> : null}
    {!auxiliarySurface ? <div className="catalog-bottom-actions" role="toolbar" aria-label={t("catalogActions")}><div className="ga-footer-left"><BackendStatus /><LanguageSwitch /></div><div className="catalog-scroll-action" ref={setActionsTarget} /><button type="button" className="catalog-refresh-button" onClick={refreshCatalog} disabled={refreshing} aria-busy={refreshing} aria-label={t("refreshGamesAria")} title={t("refreshGamesTitle")}><span aria-hidden="true">↻</span><strong>{t("refreshGames")}</strong></button></div> : null}
    <App key={mode} actionsTarget={actionsTarget} catalogNavigation={!auxiliarySurface ? <CatalogTabs mode={mode} onChange={changeMode} /> : null} />
  </>;
}

void startNarrationSession(import.meta.env.VITE_BUILD_TIMESTAMP ?? "", getCatalogMode());

const root = document.getElementById("root");
if (!root) throw new Error("gameAccess root element is missing");

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <WindowChrome /><PixelAppearance />
    <AppCrashBoundary><ActivationGate><RuntimeGate><CatalogShell /><AppSettings /></RuntimeGate></ActivationGate></AppCrashBoundary>
  </React.StrictMode>,
);

void startLocalAutomation();
