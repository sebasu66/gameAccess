import { useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import type { CatalogGame } from "./types";
import { applySourceAvailability, SOURCES_CHANGED_EVENT } from "./catalog/PluginSources";
import { runPluginSourcesTask } from "./centralDialog/pluginTask";
import { listen } from "@tauri-apps/api/event";
import { hasTauriRuntime } from "./native";
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
      void runPluginSourcesTask();
    };

    window.addEventListener(SOURCES_CHANGED_EVENT, changed);
    window.addEventListener(PLUGINS_CHANGED_EVENT, pluginChanged);
    const stopMonitoring = monitorPluginRuntime();

    const initialGen = pluginGeneration();
    lastGenerationRef.current = initialGen;
    void runPluginSourcesTask();
    // A plugin installed while the app is open is started by the app and synced at once (no restart needed).
    const stopInstalled = hasTauriRuntime()
      ? listen("gameaccess:plugin-installed", () => void runPluginSourcesTask({ waitForPlugin: true })).catch(() => () => undefined)
      : Promise.resolve(() => undefined);

    return () => {
      stopped = true;
      void stopInstalled.then(stop => stop());
      stopMonitoring();
      window.removeEventListener(SOURCES_CHANGED_EVENT, changed);
      window.removeEventListener(PLUGINS_CHANGED_EVENT, pluginChanged);
    };
  }, [setGames]);
}
