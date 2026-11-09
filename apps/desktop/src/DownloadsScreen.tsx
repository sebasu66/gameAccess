import { useAppScreen } from "./appScreen";
import AreaTabs from "./AreaTabs";
import GaScreen from "./components/ga/Screen";
import DigitalDownloadsScreen from "./DigitalDownloadsScreen";
import { activeDownloadService } from "./downloads/activeService";
import { openSection } from "./gameArea";
import { useI18n } from "./i18n";
import type { CatalogGame } from "./types";
import "./downloads-screen.css";

/**
 * The Download Manager as a section of the Catalog (gameArea.ts, Seba 2026-11-09): every download, from the first
 * step to installed, is followed here and only here. A finished game goes to the Library; the Library and its manager
 * do not show downloads.
 */
export default function DownloadsScreen({ games, onPlay, onOpenGame }: { games: CatalogGame[]; onPlay?: (game: CatalogGame) => void | Promise<void>; onOpenGame?: (game: CatalogGame) => void }) {
  const { t } = useI18n();
  const screen = useAppScreen();
  if (screen !== "downloads") return null;
  return <GaScreen id="ga-downloads" mode="downloads" title={t("downloadsTitle")} subtitle={t("downloadsScreenSubtitle")} className="ga-downloads-screen">
    <div className="ga-downloads-content ga-stack">
      <AreaTabs area="catalog" />
      <DigitalDownloadsScreen embedded service={activeDownloadService()} catalogGames={games} onPlay={onPlay}
        onOpenGame={game => { openSection("catalog"); onOpenGame?.(game); }} onClose={() => openSection("catalog")} />
    </div>
  </GaScreen>;
}
