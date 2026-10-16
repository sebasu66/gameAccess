import { useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import type { CatalogGame } from "./types";
import { applySourceAvailability, checkPluginSources, invalidatePluginSources, SOURCES_CHANGED_EVENT } from "./catalog/PluginSources";
import { monitorPluginRuntime, PLUGINS_CHANGED_EVENT, pluginGeneration } from "./catalog/PluginRuntime";

export function useCatalogSources(games: CatalogGame[], setGames: Dispatch<SetStateAction<CatalogGame[]>>) {
  const gamesRef = useRef(games);
  gamesRef.current = games;
  const lastGenerationRef = useRef<number | null>(null);

  useEffect(() => {
    let stopped = false;
    const changed = () => {
      if (stopped) return;
      setGames(current => {
        const next = applySourceAvailability(current);
        return next === current ? current : next;
      });
    };
    const pluginChanged = () => {
      const gen = pluginGeneration();
      if (lastGenerationRef.current === gen) return;
      lastGenerationRef.current = gen;
      void checkPluginSources();
    };

    window.addEventListener(SOURCES_CHANGED_EVENT, changed);
    window.addEventListener(PLUGINS_CHANGED_EVENT, pluginChanged);
    const stopMonitoring = monitorPluginRuntime();

    const initialGen = pluginGeneration();
    lastGenerationRef.current = initialGen;
    void checkPluginSources();

    return () => {
      stopped = true;
      stopMonitoring();
      window.removeEventListener(SOURCES_CHANGED_EVENT, changed);
      window.removeEventListener(PLUGINS_CHANGED_EVENT, pluginChanged);
    };
  }, [setGames]);
}
