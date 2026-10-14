import { useCallback, useEffect, useRef, useState } from "react";
import { digitalCatalogService } from "./catalog/DigitalCatalog";
import { CatalogUpdater, CATALOG_REFRESH_REQUEST, CATALOG_REFRESH_STATUS, shouldSyncOnOpen } from "./catalogUpdates";
import type { CatalogNotice } from "./CatalogNewGameNotices";
import type { CatalogGame } from "./types";
import { playCatalogBell } from "./uiSounds";
import { narrate } from "./narrationLog";
import { translate } from "./i18n";

export function useCatalogUpdates(games: CatalogGame[], ready: boolean, enabled: boolean, apply: (games: CatalogGame[]) => void, showError: (message: string) => void) {
  const [notices, setNotices] = useState<CatalogNotice[]>([]);
  const latest = useRef({games, apply, showError}); latest.current = {games, apply, showError};
  const sequence = useRef(0);
  const dismiss = useCallback((key: number) => setNotices(current => current.filter(notice => notice.key !== key)), []);
  useEffect(() => {
    if (!enabled || !ready) return;
    const updater = new CatalogUpdater(latest.current.games, {
      load: async () => {
        await digitalCatalogService.loadCatalog({ requireRemote: true });
        return latest.current.games;
      },
      apply: games => latest.current.apply(games),
      added: games => {
        // Importing the bundled/server baseline is synchronization, not thousands of new-release alerts.
        if (games.length > 100) {
          void narrate(`Catalog baseline synchronized: ${games.length} additional game(s); individual notices suppressed.`, {area:"CATALOG"});
          return;
        }
        const createdAt = Date.now();
        setNotices(current => [...games.map(game => ({key: ++sequence.current, game, createdAt})).reverse(), ...current].slice(0, 12));
        playCatalogBell();
        void narrate(`Catalog refresh added ${games.length} game(s).`, {area:"CATALOG"});
      },
      status: busy => window.dispatchEvent(new CustomEvent(CATALOG_REFRESH_STATUS, {detail:{busy}})),
      error: (error, manual) => {
        void narrate(`Catalog refresh failed: ${String(error)}`, {area:"CATALOG", level:"WARN"});
        if (manual) latest.current.showError(translate("catalogUpdateFailed"));
      },
    });
    const manual = () => void updater.refresh(true);
    const focus = () => updater.catchUp();
    updater.start();
    // Let the bundled catalog paint before checking for a new immutable revision,
    // only if more than 1 hour passed since last sync (or on initial install).
    let initialRefresh: number | undefined;
    if (shouldSyncOnOpen()) {
      initialRefresh = window.setTimeout(() => void updater.refresh(), 5000);
    }
    window.addEventListener(CATALOG_REFRESH_REQUEST, manual);
    window.addEventListener("focus", focus);
    return () => {
      if (initialRefresh) window.clearTimeout(initialRefresh);
      updater.dispose();
      window.removeEventListener(CATALOG_REFRESH_REQUEST, manual);
      window.removeEventListener("focus", focus);
    };
  }, [enabled, ready]);
  return {notices, dismiss};
}
