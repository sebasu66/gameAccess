import ActivityConsole from "./ActivityConsole";
import GaNotice from "./notice/GaNotice";
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
import { setAppScreen } from "./appScreen";
import { opensOn, startScreenUsed } from "./startupPreferences";
import { useOpeningSettled } from "./centralDialog/openingSettled";
import { runStartupPreparation } from "./centralDialog/catalogTask";
import { reportFrontendAlive } from "./appAlive";
import BackendStatus from "./BackendStatus";
import PremiumEntry from "./PremiumEntry";
import { startModalStack } from "./modalStack";
import { startSingleAccordion } from "./singleAccordion";
import { startPlusLook } from "./plusLook";
import { trackAppVersion } from "./releaseNotes";
import { repairShortcutIcons } from "./shortcutIcons";
import { startSteamGuide } from "./steamGuide";
import { startSmokeStage } from "./components/ga/smokeStage";
import AccessPass from "./AccessPass";
import { PluginIndicator } from "./PluginIndicator";
import PixelAppearance from "./PixelAppearance";
import AmbientBackground from "./AmbientBackground";
import GameLibraryManager from "./library-manager/GameLibraryManager";
import { libraryDemo } from "./libraryScan";
import WindowChrome from "./WindowChrome";
import KidScreen from "./KidScreen";
import { readKidSession, type KidSession } from "./kidMode";
import ParentKeyDialog from "./ParentKeyDialog";
import { startLocalAutomation } from "./automation";
import { getCatalogMode, setCatalogMode, type CatalogMode } from "./catalogMode";
import { narrate, startClientErrorReporting, startNarrationSession } from "./narrationLog";
import { setAppLocale, translate, useI18n } from "./i18n";
import "./templates/base.css";
import "./templates/flavor-terminal.css";
import "./styles.css";

// The browser's own right-click menu (reload, inspect…) is not part of the app; text fields keep it for copy and paste.
document.addEventListener("contextmenu", event => {
  if (!(event.target as HTMLElement | null)?.closest?.("input, textarea, [contenteditable='true']")) event.preventDefault();
});
import "./session.css";
import "./experience.css";
import "./polish.css";
import "./library-room.css";
import "./download-manager.css";
import "./bootstrap.css";

import "./catalog-tabs.css";
import "./library-input-controller.css";
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
import "./ga-design.css";
import "./components/ga/content.css";

// Suppress WebView's browser menu in the native client. Keep propagation so
// game cards can still open the application's own context menu.
if (isTauri()) {
  const suppressBrowserMenu = (event: MouseEvent) => event.preventDefault();
  document.addEventListener("contextmenu", suppressBrowserMenu, true);
  import.meta.hot?.dispose(() => document.removeEventListener("contextmenu", suppressBrowserMenu, true));
}

// The desktop library currently exposes only Digital. Migrate saved source
// selections so a hidden legacy tab cannot leave the catalog in another mode.
setCatalogMode("digital");

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
  // The catalog database is in place before the library opens (the central dialog appears only if it has to be
  // installed); the news arrive afterwards, as a task of the Activity panel.
  const [prepared, setPrepared] = React.useState(false);
  React.useEffect(() => { void runStartupPreparation().finally(() => setPrepared(true)); repairShortcutIcons(); trackAppVersion(); }, []);
  useAnnouncements(prepared);
  // Home is where a new install opens, with the welcome (Settings › Appearance chooses another screen), once the
  // opening has ended: a change of mode under the logo animation would run behind it.
  const openingSettled = useOpeningSettled();
  React.useEffect(() => {
    if (!prepared || !openingSettled || !opensOn("home")) return;
    startScreenUsed("home");
    setAppScreen("home");
  }, [prepared, openingSettled]);
  const changeMode = React.useCallback((next: CatalogMode) => {
    if (next === mode) return;
    captureLibraryUiState(mode);
    void narrate(`Switching catalog view from ${mode} to ${next}. This changes which availability rules are used.`, { area: "CATALOG" });
    setCatalogMode(next);
    setMode(next);
  }, [mode]);
  return <>
    <LibraryInputController mode={mode} onModeChange={changeMode} />
    <PluginIndicator /><div className="catalog-bottom-actions" role="toolbar" aria-label={t("catalogActions")}><div className="ga-footer-left"><BackendStatus /><AccessPass /><PremiumEntry /></div><div className="catalog-scroll-action" ref={setActionsTarget} /><div className="ga-dock" ref={setDockTarget} role="group" aria-label={t("catalogActions")} /></div>
    {prepared ? <RenderProbe id="App"><App key={mode} actionsTarget={actionsTarget} dockTarget={dockTarget} catalogNavigation={<CatalogTabs mode={mode} onChange={changeMode} />} /></RenderProbe> : null}
  </>;
}

startClientErrorReporting();
startDownloadNotifications();
startModalStack();
startSingleAccordion();
startPlusLook();
void startSteamGuide();
startSmokeStage();
void startNarrationSession(import.meta.env.VITE_BUILD_TIMESTAMP ?? "", getCatalogMode());

const root = document.getElementById("root");
if (!root) throw new Error("gameAccess root element is missing");

// A sample child for design work in the browser (`?kidDemo=1`, dev builds only).
const demoKid = (): KidSession | null => import.meta.env.DEV && new URLSearchParams(window.location.search).has("kidDemo") ? {
  kid: { name: "Juan", sid: "", enabled: true, dailyMinutes: 60, weekdays: "16-20", weekend: "10-21", language: "es",
    games: ([[620, "Portal 2"], [413150, "Stardew Valley"], [881100, "Noita"], [1145360, "Hades"], [1942280, "Brotato"], [367520, "Hollow Knight"], [504230, "Celeste"],
      [105600, "Terraria"], [250900, "The Binding of Isaac: Rebirth"], [1794680, "Vampire Survivors"], [-1, "Roblox"], [646570, "Slay the Spire"]] as const)
      .map(([appId, name], index) => ({ appId, name, folder: "", executable: "", arguments: [], steam: appId > 0, featured: index === 3 || index === 7, steamAccount: appId > 0 ? "cuenta_demo" : "" })) },
  playedSeconds: 1500, remainingSeconds: 2100, playing: null, timeUp: new URLSearchParams(window.location.search).has("timeUp"), recent: [413150],
} : null;

// A child's Windows account (kidMode.ts) gets only its games, in big picture mode, and nothing else of the app.
void (libraryDemo() ? Promise.resolve(null) : readKidSession()).then(session => session ?? demoKid()).then(kid => {
  if (kid) {
    // The adult's Game Access language (Seba, 2026-10-31), not the child's Windows one.
    if (kid.kid.language === "es" || kid.kid.language === "en") setAppLocale(kid.kid.language);
    ReactDOM.createRoot(root).render(<><KidScreen initial={kid} demo={!kid.kid.sid} /><GaNotice /></>);
  } else if (libraryDemo()) {
    ReactDOM.createRoot(root).render(<><GameLibraryManager onClose={() => undefined} /><GaNotice /></>);
  } else ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <WindowChrome /><PixelAppearance /><AmbientBackground /><ActivityConsole /><GaNotice /><ParentKeyDialog /><CentralDialogView /><NativeAccessBoundary />
      <AppCrashBoundary><UpdateGate><ActivationGate><RuntimeGate><CatalogShell /></RuntimeGate></ActivationGate></UpdateGate></AppCrashBoundary>
    </React.StrictMode>,
  );
});

void startLocalAutomation();
// The native watchdog installs a pending update by itself if the interface never gets this far.
reportFrontendAlive();
