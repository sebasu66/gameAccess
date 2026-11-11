import { useEffect, useLayoutEffect, useState } from "react";
import { ACTIVATION_CHANGED_EVENT, getActivationTier } from "../activation";
import { useNews } from "../centralDialog/useAnnouncements";
import { useAppScreen, setAppScreen } from "../appScreen";
import ActivityPanel from "../activity/ActivityPanel";
import { useActiveDownloadCount } from "../downloads/useActiveDownloadCount";
import { openArea, openSection, useGameSection } from "../gameArea";
import { useI18n } from "../i18n";
import { NAVIGATION, type NavigationModeId } from "./navigationTree";
import { CATALOG_ON_HOME, getNavigationSelection, newsDestination, selectNavigationSection, shellMode, useNavigationSelection } from "./navigationSelection";
import { OPEN_NEWS_EVENT } from "../newDownloads";
import { PLUGIN_SECTION_EVENT } from "../pluginNav";
import StatusBar from "./StatusBar";
import ModeBar from "./ModeBar";
import SectionPanel from "./SectionPanel";
import { applyShellLook, clearShellLook, currentCssValue, useShellLook } from "./shellLook";
import "./navigation-shell.css";

export { navigationShellEnabled } from "./navigationSelection";

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
  const { unread } = useNews();
  const navigationSelection = useNavigationSelection();
  const [tier, setTier] = useState(getActivationTier);
  const mode = shellMode(screen, gameSection?.area, navigationSelection.homeMode);
  const selectedSection = mode === "library" ? gameSection?.section ?? "play" : mode === "settings" && screen === "kids" ? "parental"
    : mode === "settings" ? navigationSelection.settings : mode === "gameAccess" ? navigationSelection.gameAccess
    : screen === "home" ? navigationSelection.catalog : "explore";
  const look = useShellLook();
  // The style's choices that CSS cannot test by value (a pattern, an icon fill) become attributes the screen layer selects.
  const [looks, setLooks] = useState<Record<string, string>>({});
  useLayoutEffect(() => {
    applyShellLook(look);
    setLooks({ "data-rail-graphic": currentCssValue("--ga-nav-rail-graphic"), "data-icon-fill": currentCssValue("--ga-nav-icon-fill"), "data-button-fill": currentCssValue("--ga-nav-button-fill") });
  }, [look]);
  useEffect(() => () => clearShellLook(), []);
  // The content zone is outside the shell's layer: the mode goes on the page so the zone takes its colour too (§4.3).
  useLayoutEffect(() => { document.documentElement.dataset.gaNavMode = mode; }, [mode]);
  useEffect(() => () => { delete document.documentElement.dataset.gaNavMode; }, []);

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

  return <div className="ga-nav-shell" data-mode={mode} {...looks}>
    <ModeBar mode={mode} word={look.word} badges={{ library: downloads, gameAccess: unread }} onOpen={openMode} />
    <SectionPanel mode={mode} selected={selectedSection} reachable={section => reachable(mode, section)} onOpen={section => openExistingSection(mode, section)} />
    <aside className="ga-nav-activity" aria-label={t("processesTitle")}>
      <div className="ga-nav-brand"><strong>{t("navModeGameAccess")}</strong><span>{t(tier ? "navPlanPlus" : "navPlanBase")}</span></div>
      <div className="ga-nav-activity-scroll"><ActivityPanel /></div>
    </aside>
    <StatusBar />
  </div>;
}
