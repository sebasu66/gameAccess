import { useEffect, useRef, useState } from "react";

import { loadDetails } from "./api";
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

interface UseSelectedGameDetailsInput extends SelectedDetailRequest {}

export interface SelectedGameDetailsState {
  details: GameDetails | null;
  loading: boolean;
  error: string | null;
}

export function useSelectedGameDetails(input: UseSelectedGameDetailsInput): SelectedGameDetailsState {
  const [details, setDetails] = useState<GameDetails | null>(null);
  const [detailsGameId, setDetailsGameId] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestTokenRef = useRef(0);

  useEffect(() => {
    const token = ++requestTokenRef.current;
    const selectedGameId = input.selectedGameId;
    const shouldLoad = shouldLoadSelectedDetails(input);

    setDetails(null);
    setDetailsGameId(null);
    setError(null);
    if (!shouldLoad || selectedGameId == null) {
      setLoading(false);
      return;
    }

    setLoading(true);
    const requestedGameId = selectedGameId;
    void loadDetails(requestedGameId)
      .then((value) => {
        if (requestTokenRef.current !== token || !isCurrentSelectedDetail(requestedGameId, input.selectedGameId)) return;
        setDetails(value);
        setDetailsGameId(requestedGameId);
      })
      .catch((reason: unknown) => {
        if (requestTokenRef.current !== token) return;
        setError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => {
        if (requestTokenRef.current === token) setLoading(false);
      });
  }, [input.surface, input.selectedGameId, input.detailRequestedGameId, input.tabletDetailsOpen]);

  return {
    details: detailsGameId === input.selectedGameId ? details : null,
    loading,
    error,
  };
}
