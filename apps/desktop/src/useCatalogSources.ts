import { useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import type { CatalogGame } from "./types";
import { applySourceAvailability, checkPluginSources, SOURCES_CHANGED_EVENT } from "./catalog/PluginSources";

export function useCatalogSources(games: CatalogGame[], setGames: Dispatch<SetStateAction<CatalogGame[]>>) {
  const gamesRef = useRef(games);
  gamesRef.current = games;
  const key = JSON.stringify(games.map(game => [game.app_id ?? game.id, game.name]));
  useEffect(() => {
    if (!gamesRef.current.length) return;
    let stopped = false;
    let checking = false;
    const changed = () => { if (!stopped) setGames(current => applySourceAvailability(current)); };
    const refresh = async () => {
      if (checking) return;
      checking = true;
      try { await checkPluginSources(gamesRef.current); } finally { checking = false; }
    };
    window.addEventListener(SOURCES_CHANGED_EVENT, changed);
    window.addEventListener("focus", refresh);
    void refresh();
    const timer = window.setInterval(() => void refresh(), 30000);
    return () => { stopped = true; window.clearInterval(timer); window.removeEventListener(SOURCES_CHANGED_EVENT, changed); window.removeEventListener("focus", refresh); };
  }, [key, setGames]);
}
