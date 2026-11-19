import { useEffect, useSyncExternalStore } from "react";
import { Bell, CircleHelp, Download, HardDrive, Puzzle, RefreshCw, TriangleAlert } from "lucide-react";
import BackendStatus from "../BackendStatus";
import { getPluginStatuses, subscribePluginStatuses } from "../catalog/PluginRuntime";
import { useNews } from "../centralDialog/useAnnouncements";
import { setAppScreen } from "../appScreen";
import { useActiveDownloads } from "../downloads/useActiveDownloadCount";
import { openSection } from "../gameArea";
import { useI18n } from "../i18n";
import { useLibraryScan } from "../libraryScan";
import { openPluginSection } from "../pluginNav";
import { selectNavigationSection, selectNavigationTab } from "./navigationSelection";
import { loadDrives, useLibraryDrives } from "../library-manager/libraryDrives";
import { diskFreePercent, disksInUse, formatSpeed, formatSyncTime, useAppVersion, useCatalogSync } from "./statusBarData";

const openNews = () => { selectNavigationSection("gameAccess", "news"); setAppScreen("home"); };
/** The Help shortcut: Game Access › Support, on its questions (contact is beside them). */
const openSupport = () => { selectNavigationSection("gameAccess", "support"); selectNavigationTab("gameAccess", "support", "faq"); setAppScreen("home"); };

/** The shell's status bar (vault/Rediseño de navegación.md §4.5): each part opens its place. */
export default function StatusBar() {
  const { t, locale } = useI18n();
  const plugins = useSyncExternalStore(subscribePluginStatuses, getPluginStatuses, getPluginStatuses);
  const livePlugins = plugins.filter(plugin => plugin.alive && plugin.enabled !== false).length;
  const { unread } = useNews();
  const downloads = useActiveDownloads();
  const disk = diskFreePercent(useLibraryScan().summary);
  // Every disk turned on for games, worst first; while they are not known yet, the games folder's own disk.
  const { drives } = useLibraryDrives();
  useEffect(() => { void loadDrives().catch(() => undefined); }, []);
  const disks = disksInUse(drives);
  const sync = useCatalogSync();
  const version = useAppVersion();

  return <footer className="ga-nav-status" aria-label={t("navStatusAria")}>
    <BackendStatus />
    <span className="ga-nav-status-sep" aria-hidden="true" />
    <button type="button" className="ga-nav-status-item" data-state={!plugins.length ? "off" : livePlugins ? "on" : "bad"}
      onClick={() => openPluginSection(plugins[0]?.id ?? "")} disabled={!plugins.length}>
      <Puzzle aria-hidden="true" />{t("navPlugins")} <b>{plugins.length ? livePlugins : "—"}</b>
    </button>
    <span className="ga-nav-status-sep" aria-hidden="true" />
    <button type="button" className="ga-nav-status-item ga-nav-disks" title={disks.length ? disks.map(one => `${one.letter} ${one.name ? `${one.name} ` : ""}${one.percent} %`).join(" · ") : undefined}
      onClick={() => openSection("manager")}>
      <HardDrive aria-hidden="true" />
      {/* The figure stays in the bar's own ink: only a mark beside it says that one is running out (§4.52). */}
      {disks.length
        ? disks.slice(0, 3).map(one => <span key={one.letter} className="ga-nav-disk">
            <b>{one.name ? t("navDiskNamedFree", { letter: one.letter, name: one.name, pct: one.percent }) : t("navDiskOneFree", { letter: one.letter, pct: one.percent })}</b>
            {one.level === "fine" ? null : <TriangleAlert className="ga-nav-disk-warn" data-level={one.level} aria-label={t(one.level === "critical" ? "navDiskCritical" : "navDiskLow", { letter: one.letter })} />}
          </span>)
        : disk == null ? <>{t("navDisk")} <b>—</b></> : <b>{t("navDiskFree", { pct: disk })}</b>}
    </button>
    <span className="ga-nav-status-sep" aria-hidden="true" />
    <button type="button" className="ga-nav-status-item ga-nav-status-accent" onClick={() => openSection("downloads")}>
      <Download aria-hidden="true" />{t("navDownloads")} <b>{t("navDownloadsActive", { count: downloads.inProgress })} · {formatSpeed(downloads.speedBps, locale)}</b>
      {downloads.speedBps > 0 && <span className="ga-nav-meter" aria-hidden="true"><i /><i /><i /><i /></span>}
    </button>
    <span className="ga-nav-status-grow" />
    <button type="button" className="ga-nav-status-item ga-nav-status-sync" data-busy={sync.busy || undefined} onClick={() => openSection("catalog")}>
      <RefreshCw aria-hidden="true" />{sync.busy ? t("navCatalogUpdating") : sync.at ? <>{t("navCatalogUpToDate")} · <b>{formatSyncTime(sync.at, Date.now(), locale)}</b></> : t("navCatalogNever")}
    </button>
    {version && <><span className="ga-nav-status-sep" aria-hidden="true" />
      <button type="button" className="ga-nav-status-item" onClick={openNews}>{t("navVersion")} <b>{version}</b></button></>}
    <span className="ga-nav-status-sep" aria-hidden="true" />
    <button type="button" className="ga-nav-status-item" onClick={openSupport}><CircleHelp aria-hidden="true" />{t("navHelpShortcut")}</button>
    <button type="button" className="ga-nav-status-item ga-nav-status-bell" onClick={openNews} aria-label={t("navNewsUnread", { count: unread })}>
      <Bell aria-hidden="true" />{unread > 0 && <em>{unread}</em>}
    </button>
  </footer>;
}
