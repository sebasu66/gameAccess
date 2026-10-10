import { useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import type { CatalogGame } from "./types";
import { applySourceAvailability, checkPluginSources, invalidatePluginSources, SOURCES_CHANGED_EVENT } from "./catalog/PluginSources";
import { monitorPluginRuntime, PLUGINS_CHANGED_EVENT } from "./catalog/PluginRuntime";
export function useCatalogSources(games: CatalogGame[], setGames: Dispatch<SetStateAction<CatalogGame[]>>) {
  const gamesRef = useRef(games);
  gamesRef.current = games;
  const key = JSON.stringify(games.map(game => [game.app_id ?? game.id, game.name]));
  useEffect(() => {
    let stopped = false;
    const changed = () => { if (!stopped) setGames(current => applySourceAvailability(current)); };
    const refresh = () => { if (gamesRef.current.length) void checkPluginSources(gamesRef.current); };
    const pluginChanged = () => { invalidatePluginSources(); refresh(); };
    window.addEventListener(SOURCES_CHANGED_EVENT, changed);
    window.addEventListener(PLUGINS_CHANGED_EVENT, pluginChanged);
    window.addEventListener("focus", refresh);
    const stopMonitoring = monitorPluginRuntime();
    refresh();
    return () => {
      stopped = true; stopMonitoring();
      window.removeEventListener(SOURCES_CHANGED_EVENT, changed);
      window.removeEventListener(PLUGINS_CHANGED_EVENT, pluginChanged);
      window.removeEventListener("focus", refresh);
    };
  }, [key, setGames]);
}
