import { useEffect, useRef, useState } from "react";

import { loadDetails } from "./api";
import { narrate } from "./narrationLog";
import { useI18n } from "./i18n";
import { getSteamStoreMetadata, hasTauriRuntime } from "./native";
import { mergeLocalSteamDetails } from "./steamMetadata";
import type { CatalogGame, GameDetails } from "./types";

export type LibrarySurfaceMode = "desktop" | "tablet" | "display";

export interface SelectedDetailRequest {
  surface: LibrarySurfaceMode;
  selectedGameId?: number;
  detailRequestedGameId: number | null;
  tabletDetailsOpen: boolean;
}

export function shouldLoadSelectedDetails(request: SelectedDetailRequest): boolean {
  const selected = request.selectedGameId;
  if (selected == null) return false;
  if (request.surface === "desktop") return true;
  if (request.surface === "tablet") {
    return request.tabletDetailsOpen && request.detailRequestedGameId === selected;
  }
  return request.detailRequestedGameId === selected;
}

export function isCurrentSelectedDetail(requestedGameId: number, selectedGameId?: number): boolean {
  return selectedGameId != null && requestedGameId === selectedGameId;
}

interface UseSelectedGameDetailsInput extends SelectedDetailRequest {
  // Opt in only for the open detail overlay, never for keyboard/grid selection.
  localSteamAppId?: number | null;
  knownGame?: CatalogGame;
}

export interface SelectedGameDetailsState {
  details: GameDetails | null;
  loading: boolean;
  error: string | null;
  refreshingSteam: boolean;
  refreshSteam: () => Promise<void>;
}

export function useSelectedGameDetails(input: UseSelectedGameDetailsInput): SelectedGameDetailsState {
  const { surface, selectedGameId, detailRequestedGameId, tabletDetailsOpen, localSteamAppId } = input;
  const { locale } = useI18n();
  const [details, setDetails] = useState<GameDetails | null>(null);
  const [detailsGameId, setDetailsGameId] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestTokenRef = useRef(0);
  const [refreshingSteam, setRefreshingSteam] = useState(false);

  const updateSteam = async (base: GameDetails, token: number, force: boolean) => {
    if (!localSteamAppId || !hasTauriRuntime()) return;
    setRefreshingSteam(true);
    try {
      const raw = await getSteamStoreMetadata(localSteamAppId, force);
      if (requestTokenRef.current !== token || !raw) return;
      setDetails(mergeLocalSteamDetails(base, raw));
      void narrate(`AppID ${localSteamAppId} · Steam metadata refreshed${typeof raw.gameaccess_refresh_warning === "string" ? "; warning=" + raw.gameaccess_refresh_warning : "."}`, { area: "CATALOG" });
    } catch {
      if (requestTokenRef.current === token) void narrate(`AppID ${localSteamAppId} · Steam metadata refresh failed; retaining previous details.`, { area: "CATALOG", level: "WARN" });
    } finally {
      if (requestTokenRef.current === token) setRefreshingSteam(false);
    }
  };

  useEffect(() => {
    const token = ++requestTokenRef.current;
    const shouldLoad = shouldLoadSelectedDetails({
      surface,
      selectedGameId,
      detailRequestedGameId,
      tabletDetailsOpen,
    });

    setDetails(null);
    setDetailsGameId(null);
    setError(null);
    setRefreshingSteam(false);
    if (!shouldLoad || selectedGameId == null) {
      setLoading(false);
      return;
    }

    setLoading(true);
    const requestedGameId = selectedGameId;
    void loadDetails(requestedGameId, input.knownGame)
      .then((value) => {
        if (requestTokenRef.current !== token || !isCurrentSelectedDetail(requestedGameId, selectedGameId)) return;
        setDetails(value);
        setDetailsGameId(requestedGameId);
        // Cached server/local details remain stable; refresh only on explicit request.
      })
      .catch((reason: unknown) => {
        if (requestTokenRef.current !== token) return;
        setError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => {
        if (requestTokenRef.current === token) setLoading(false);
      });
    return () => { ++requestTokenRef.current; };
  }, [surface, selectedGameId, detailRequestedGameId, tabletDetailsOpen, locale, localSteamAppId]);

  return {
    details: detailsGameId === selectedGameId ? details : null,
    loading,
    error,
    refreshingSteam,
    refreshSteam: async () => {
      if (details && detailsGameId === selectedGameId && !refreshingSteam) await updateSteam(details, requestTokenRef.current, true);
    },
  };
}
