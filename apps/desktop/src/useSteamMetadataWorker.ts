import { useEffect, type Dispatch, type SetStateAction } from "react";
import { invoke } from "@tauri-apps/api/core";
import { hasTauriRuntime } from "./native";
import { mergeLocalCatalogMetadata } from "./steamMetadata";
import type { CatalogGame } from "./types";

type MetadataMap = Record<string, Record<string, unknown>>;
export async function cachedSteamCatalogMetadata(appIds: number[]): Promise<MetadataMap> {
  if (!hasTauriRuntime() || !appIds.length) return {};
  try { return await invoke<MetadataMap>("steam_metadata_catalog_cache", { appIds }); }
  catch { return {}; }
}
export function applySteamCatalogMetadata(games: CatalogGame[], metadata: MetadataMap): CatalogGame[] {
  return games.map(game => game.app_id && metadata[game.app_id] ? mergeLocalCatalogMetadata(game, metadata[game.app_id]) : game);
}

/** The native serial worker survives minimization. Poll only its compact updates;
 * no network fan-out from React, and no resets when a game's metadata changes. */
export function useSteamMetadataWorker(games: CatalogGame[], setGames: Dispatch<SetStateAction<CatalogGame[]>>) {
  const ids = [...new Set(games.flatMap(game => game.app_id ? [game.app_id] : []))].sort((a,b) => a-b).join(",");
  useEffect(() => {
    if (!hasTauriRuntime() || !ids) return;
    let cancelled = false;
    let busy = false;
    const appIds = ids.split(",").map(Number);
    void invoke("steam_metadata_worker_start", { appIds }).catch(() => undefined);
    const poll = async () => {
      if (busy) return;
      busy = true;
      try {
        const result = await invoke<{ metadata: MetadataMap; status: { phase: string; completed: number; total: number } }>("steam_metadata_worker_poll");
        if (!cancelled && Object.keys(result.metadata).length) setGames(current => applySteamCatalogMetadata(current, result.metadata));
      } catch { /* Keep the catalog usable if the native worker is unavailable. */ }
      finally { busy = false; }
    };
    const timer = window.setInterval(() => void poll(), 10000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [ids, setGames]);
}
