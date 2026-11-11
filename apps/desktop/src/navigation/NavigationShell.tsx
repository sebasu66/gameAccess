import { useEffect, useState, useSyncExternalStore } from "react";
import { Gamepad2, House, LayoutGrid, Settings } from "lucide-react";
import { ACTIVATION_CHANGED_EVENT, getActivationTier } from "../activation";
import BackendStatus from "../BackendStatus";
import { getPluginStatuses, subscribePluginStatuses } from "../catalog/PluginRuntime";
import { useNews } from "../centralDialog/useAnnouncements";
import { useAppScreen, setAppScreen } from "../appScreen";
import ActivityPanel from "../activity/ActivityPanel";
import { useActiveDownloadCount } from "../downloads/useActiveDownloadCount";
import { openArea, openSection, useGameSection } from "../gameArea";
import { useI18n } from "../i18n";
import { NAVIGATION, type NavigationModeId } from "./navigationTree";
import { CATALOG_ON_HOME, getNavigationSelection, newsDestination, selectNavigationSection, shellMode, useNavigationSelection } from "./navigationSelection";
import { OPEN_NEWS_EVENT } from "../newDownloads";
import { openPluginSection, PLUGIN_SECTION_EVENT } from "../pluginNav";
import "./navigation-shell.css";

/** Development entry point for the RN2 shell while legacy pages are being moved into its content zone. */
export const navigationShellEnabled = () => typeof window !== "undefined" && new URLSearchParams(window.location.search).get("navigationShell") === "1";

const MODE_ICONS = { catalog: LayoutGrid, library: Gamepad2, gameAccess: House, settings: Settings } as const;

function openMode(mode: NavigationModeId) {
  if (mode === "catalog" || mode === "library") openArea(mode);
  else {
    if (mode === "gameAccess") selectNavigationSection("gameAccess", getNavigationSelection().gameAccess);
    if (mode === "settings") selectNavigationSection("settings", "general");
    setAppScreen(mode === "gameAccess" ? "home" : "settings");
  }
}

function openExistingSection(mode: NavigationModeId, section: string) {
  selectNavigationSection(mode, section);
  if (mode === "library" && (section === "play" || section === "downloads" || section === "manager")) openSection(section);
  else if (mode === "catalog" && section === "explore") openSection("catalog");
  // AI suggestions and new games are still drawn by the Home screen (HomeScreen.tsx), hosted as Catalog.
  else if (mode === "catalog" && (CATALOG_ON_HOME as readonly string[]).includes(section)) setAppScreen("home");
  else if (mode === "gameAccess") setAppScreen("home");
  else if (mode === "settings") setAppScreen(section === "parental" ? "kids" : "settings");
}

const reachable = (mode: NavigationModeId, section: string) => mode === "library"
  || mode === "catalog" && (section === "explore" || (CATALOG_ON_HOME as readonly string[]).includes(section))
  || mode === "gameAccess"
  || mode === "settings";

/** Four zones around the existing screens while their sections move into the new hierarchy. */
export default function NavigationShell() {
  const { t } = useI18n();
  const screen = useAppScreen();
  const gameSection = useGameSection();
  const downloads = useActiveDownloadCount();
  const plugins = useSyncExternalStore(subscribePluginStatuses, getPluginStatuses, getPluginStatuses);
  const { unread } = useNews();
  const navigationSelection = useNavigationSelection();
  const [tier, setTier] = useState(getActivationTier);
  const mode = shellMode(screen, gameSection?.area, navigationSelection.homeMode);
  const selectedSection = mode === "library" ? gameSection?.section ?? "play" : mode === "settings" && screen === "kids" ? "parental"
    : mode === "settings" ? navigationSelection.settings : mode === "gameAccess" ? navigationSelection.gameAccess
    : screen === "home" ? navigationSelection.catalog : "explore";
  const current = NAVIGATION.find(item => item.id === mode)!;

  useEffect(() => {
    document.documentElement.classList.add("ga-navigation-shell");
    const updateTier = () => setTier(getActivationTier());
    window.addEventListener(ACTIVATION_CHANGED_EVENT, updateTier);
    return () => {
      document.documentElement.classList.remove("ga-navigation-shell");
      window.removeEventListener(ACTIVATION_CHANGED_EVENT, updateTier);
    };
  }, []);

  useEffect(() => {
    const showPlugins = () => selectNavigationSection("settings", "plugins");
    // A notice or an Activity entry opens a news item (newDownloads.ts goes to Home): new downloads are Catalog's.
    const showNews = (event: Event) => { const to = newsDestination(String((event as CustomEvent<string>).detail ?? "")); selectNavigationSection(to.mode, to.section); };
    window.addEventListener(PLUGIN_SECTION_EVENT, showPlugins);
    window.addEventListener(OPEN_NEWS_EVENT, showNews);
    return () => { window.removeEventListener(PLUGIN_SECTION_EVENT, showPlugins); window.removeEventListener(OPEN_NEWS_EVENT, showNews); };
  }, []);

  return <div className="ga-nav-shell" data-mode={mode}>
    <nav className="ga-nav-modes" aria-label={t("navModesAria")}>
      <strong className="ga-nav-current-mode">{t(current.label)}</strong>
      <div className="ga-nav-mode-buttons">{NAVIGATION.filter(item => item.id !== mode).map(item => {
        const Icon = MODE_ICONS[item.id];
        return <button key={item.id} type="button" data-target={item.id} onClick={() => openMode(item.id)} aria-label={t(item.label)}>
          <Icon aria-hidden="true" /><span>{t(item.label)}</span>
        </button>;
      })}</div>
    </nav>
    <nav className="ga-nav-sections" aria-label={t("navSectionsAria")}>
      <h2 className="ga-nav-section-title">{t(current.sections.find(section => section.id === selectedSection)?.label ?? current.sections[0].label)}</h2>
      <div className="ga-nav-section-list">{current.sections.map(section => <button key={section.id} type="button"
        aria-current={section.id === selectedSection ? "page" : undefined}
        disabled={!reachable(mode, section.id)}
        onClick={() => openExistingSection(mode, section.id)}>{t(section.label)}</button>)}</div>
    </nav>
    <aside className="ga-nav-activity" aria-label={t("processesTitle")}>
      <div className="ga-nav-brand"><strong>{t("navModeGameAccess")}</strong><span>{t(tier ? "navPlanPlus" : "navPlanBase")}</span></div>
      <div className="ga-nav-activity-scroll"><ActivityPanel /></div>
    </aside>
    <footer className="ga-nav-status" aria-label={t("navStatusAria")}>
      <BackendStatus />
      <button type="button" onClick={() => { openPluginSection(plugins[0]?.id ?? ""); }} disabled={!plugins.length}>
        {t("navPlugins")} · {plugins.length ? plugins.filter(plugin => plugin.alive && plugin.enabled !== false).length : "—"}
      </button>
      <button type="button" onClick={() => openSection("downloads")}>{t("navDownloads")} · {downloads}</button>
      <button type="button" onClick={() => { selectNavigationSection("gameAccess", "news"); setAppScreen("home"); }}>{t("navNews")} · {unread}</button>
    </footer>
  </div>;
}
