import { useSyncExternalStore } from "react";
import { RefreshCw } from "lucide-react";
import { CATALOG_REFRESH_REQUEST, CATALOG_REFRESH_STATUS } from "./catalogUpdates";
import { getCatalogMode } from "./catalogMode";
import { captureLibraryUiState } from "./LibraryInputController";
import { GaIconButton } from "./components/ga/Buttons";
import { narrate } from "./narrationLog";
import { useI18n } from "./i18n";

// Checks also run on their own while this screen is closed, so the state is kept here rather than in the button.
let busy = false;
if (typeof window !== "undefined") window.addEventListener(CATALOG_REFRESH_STATUS, event => { busy = (event as CustomEvent<{ busy: boolean }>).detail.busy; });
const subscribe = (changed: () => void) => {
  window.addEventListener(CATALOG_REFRESH_STATUS, changed);
  return () => window.removeEventListener(CATALOG_REFRESH_STATUS, changed);
};

/** Asks the catalog for updates; it lives on the catalog screen, the only place that shows what it brings. */
export default function CatalogRefreshButton() {
  const { t } = useI18n();
  const refreshing = useSyncExternalStore(subscribe, () => busy, () => false);
  const refresh = () => {
    const mode = getCatalogMode();
    captureLibraryUiState(mode);
    void narrate(`Manual catalog refresh requested while viewing ${mode}.`, { area: "CATALOG" });
    window.dispatchEvent(new Event(CATALOG_REFRESH_REQUEST));
  };
  return <GaIconButton className="ga-catalog-refresh" icon={<RefreshCw size={20} aria-hidden="true" />} label={t("refreshGames")} title={t("refreshGamesTitle")} onClick={refresh} disabled={refreshing} aria-busy={refreshing} />;
}
