import { useAppScreen } from "./appScreen";
import AreaTabs from "./AreaTabs";
import GaScreen from "./components/ga/Screen";
import DigitalDownloadsScreen from "./DigitalDownloadsScreen";
import { activeDownloadService } from "./downloads/activeService";
import { openSection } from "./gameArea";
import { useI18n } from "./i18n";
import type { CatalogGame } from "./types";
import { navigationShellEnabled } from "./navigation/navigationSelection";
import { useSectionTab } from "./navigation/navigationSelection";
import "./downloads-screen.css";

/**
 * The Download Manager as a section of the Library (vault/Rediseño de navegación.md §2): every download, from the
 * first step to installed, is followed here and only here. A finished game shows in Library › Play; Play and the
 * Library Manager do not show downloads.
 */
export default function DownloadsScreen({ games, onPlay, onOpenGame }: { games: CatalogGame[]; onPlay?: (game: CatalogGame) => void | Promise<void>; onOpenGame?: (game: CatalogGame) => void }) {
  const { t } = useI18n();
  const screen = useAppScreen();
  const tab = useSectionTab("downloads");
  const only = navigationShellEnabled() ? tab as "active" | "queued" | "completed" | undefined : undefined;
  if (screen !== "downloads") return null;
  return <GaScreen id="ga-downloads" mode="downloads" title={t("downloadsTitle")} subtitle={t("downloadsScreenSubtitle")} className="ga-downloads-screen">
    <div className="ga-downloads-content ga-stack">
      <AreaTabs area="library" />
      <DigitalDownloadsScreen embedded only={only} service={activeDownloadService()} catalogGames={games} onPlay={onPlay}
        onOpenGame={game => { openSection("catalog"); onOpenGame?.(game); }} onClose={() => openSection("play")} />
    </div>
  </GaScreen>;
}
