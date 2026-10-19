import ActivityConsole from "./ActivityConsole";
import Toaster from "./Toaster";
import { startDownloadNotifications } from "./downloadNotifications";
import RenderProbe from "./RenderProbe";
import React from "react";
import ReactDOM from "react-dom/client";
import { isTauri } from "@tauri-apps/api/core";
import App from "./App";
import ActivationGate from "./ActivationGate";
import NativeAccessBoundary from "./NativeAccessBoundary";
import CatalogTabs from "./CatalogTabs";
import LibraryInputController, { captureLibraryUiState } from "./LibraryInputController";
import RuntimeGate from "./RuntimeGate";
import UpdateGate from "./UpdateGate";
import CentralDialogView from "./centralDialog/CentralDialogView";
import { useAnnouncements } from "./centralDialog/useAnnouncements";
import { reportFrontendAlive } from "./appAlive";
import BackendStatus from "./BackendStatus";
import PremiumEntry from "./PremiumEntry";
import LanguageSwitch from "./LanguageSwitch";
import { Globe2, Megaphone, RefreshCw } from "lucide-react";
import PixelAppearance from "./PixelAppearance";
import GameLibraryManager from "./library-manager/GameLibraryManager";
import { libraryDemo } from "./libraryScan";
import WindowChrome from "./WindowChrome";
import { startLocalAutomation } from "./automation";
import { getCatalogMode, setCatalogMode, type CatalogMode } from "./catalogMode";
import { narrate, startClientErrorReporting, startNarrationSession } from "./narrationLog";
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
import "./dock.css";
import "./filter-wizard.css";
import "./tabs.css";
import "./pixel-appearance.css";
import "./utility-controls.css";
import "./library-manager/library-manager.css";

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
  const [dockTarget, setDockTarget] = React.useState<HTMLDivElement | null>(null);
  const [mode, setMode] = React.useState<CatalogMode>(() => getCatalogMode());
  const [refreshing, setRefreshing] = React.useState(false);
  const showNews = useAnnouncements();
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
    {!auxiliarySurface ? <LibraryInputController mode={mode} onModeChange={changeMode} /> : null}
    {!auxiliarySurface ? <div className="catalog-bottom-actions" role="toolbar" aria-label={t("catalogActions")}><div className="ga-footer-left"><BackendStatus /><PremiumEntry /></div><div className="catalog-scroll-action" ref={setActionsTarget} /><div className="ga-dock" ref={setDockTarget} role="group" aria-label={t("catalogActions")}><button type="button" className="catalog-refresh-button ga-dock-btn" onClick={refreshCatalog} disabled={refreshing} aria-busy={refreshing} aria-label={t("refreshGamesAria")} title={t("refreshGamesTitle")}><RefreshCw size={20} aria-hidden="true" /><span>{t("refreshGames")}</span></button><button type="button" className="ga-dock-btn" onClick={showNews} aria-label={t("newsButtonTitle")} title={t("newsButtonTitle")}><Megaphone size={20} aria-hidden="true" /><span>{t("newsButton")}</span></button></div></div> : null}
    <RenderProbe id="App"><App key={mode} actionsTarget={actionsTarget} dockTarget={dockTarget} catalogNavigation={!auxiliarySurface ? <CatalogTabs mode={mode} onChange={changeMode} /> : null} /></RenderProbe>
  </>;
}

startClientErrorReporting();
startDownloadNotifications();
void startNarrationSession(import.meta.env.VITE_BUILD_TIMESTAMP ?? "", getCatalogMode());

const root = document.getElementById("root");
if (!root) throw new Error("gameAccess root element is missing");

if (libraryDemo()) {
  ReactDOM.createRoot(root).render(<GameLibraryManager onClose={() => undefined} />);
} else ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <WindowChrome /><PixelAppearance /><div className="ga-global-language ga-entry-languages"><Globe2 size={23} aria-hidden="true" /><LanguageSwitch /></div><ActivityConsole /><Toaster /><CentralDialogView /><NativeAccessBoundary />
    <AppCrashBoundary><UpdateGate><ActivationGate><RuntimeGate><CatalogShell /></RuntimeGate></ActivationGate></UpdateGate></AppCrashBoundary>
  </React.StrictMode>,
);

void startLocalAutomation();
// The native watchdog installs a pending update by itself if the interface never gets this far.
reportFrontendAlive();
