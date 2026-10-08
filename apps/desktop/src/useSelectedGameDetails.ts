import { useEffect, useRef, useState } from "react";

import { loadDetails } from "./api";
import { useI18n } from "./i18n";
import { getSteamStoreMetadata, hasTauriRuntime } from "./native";
import { mergeLocalSteamDetails } from "./steamMetadata";
import type { GameDetails } from "./types";

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
}

export interface SelectedGameDetailsState {
  details: GameDetails | null;
  loading: boolean;
  error: string | null;
  refreshingSteam: boolean;
  steamRefreshMessage: string | null;
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
  const [steamRefreshMessage, setSteamRefreshMessage] = useState<string | null>(null);

  const updateSteam = async (base: GameDetails, token: number, force: boolean) => {
    if (!localSteamAppId || !hasTauriRuntime()) return;
    setRefreshingSteam(true);
    setSteamRefreshMessage(null);
    try {
      const raw = await getSteamStoreMetadata(localSteamAppId, force);
      if (requestTokenRef.current !== token || !raw) return;
      setDetails(mergeLocalSteamDetails(base, raw));
      setSteamRefreshMessage(typeof raw.gameaccess_refresh_warning === "string"
        ? raw.gameaccess_refresh_warning : "Datos de Steam actualizados en este equipo.");
    } catch {
      if (requestTokenRef.current === token) setSteamRefreshMessage("Steam no respondió. Se conserva la información anterior.");
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
    setSteamRefreshMessage(null);
    if (!shouldLoad || selectedGameId == null) {
      setLoading(false);
      return;
    }

    setLoading(true);
    const requestedGameId = selectedGameId;
    void loadDetails(requestedGameId)
      .then((value) => {
        if (requestTokenRef.current !== token || !isCurrentSelectedDetail(requestedGameId, selectedGameId)) return;
        setDetails(value);
        setDetailsGameId(requestedGameId);
        void updateSteam(value, token, false);
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
    steamRefreshMessage,
    refreshSteam: async () => {
      if (details && detailsGameId === selectedGameId && !refreshingSteam) await updateSteam(details, requestTokenRef.current, true);
    },
  };
}
