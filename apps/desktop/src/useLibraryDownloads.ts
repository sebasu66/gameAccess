/** Download tracking/completion only; presentation and navigation stay in LibraryRoom. */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CatalogGame } from "./types";
import type { DownloadMap } from "./LibraryRoomParts";
import type { ManagedDownloadStatus } from "./downloadTypes";
import { cancelDownloadLifecycle, pendingDownloadCompletions, recordDownloadCompletion, type DownloadJobRecord } from "./downloadLifecycle";
import { DOWNLOAD_REQUESTED_EVENT, DOWNLOAD_REQUEST_FAILED_EVENT, downloadManager } from "./downloadManager";
import { steamDownloadStatus } from "./native";
import { gameStateManager } from "./GameStateManager";
import { getCatalogMode } from "./catalogMode";

type DownloadEventDetail = { appId?: number; error?: string };
type CompletionEntry = { record: DownloadJobRecord; game: CatalogGame };

export function useLibraryDownloads(games: CatalogGame[], downloads: DownloadMap) {
  const requestStartedAtRef = useRef(new Map<number, number>());
  const activeSeenRef = useRef(new Set<number>());
  const missingPollsRef = useRef(new Map<number, number>());
  const previousDownloadStatesRef = useRef(new Map<number, string>());
  const gamesByAppIdRef = useRef(new Map<number, CatalogGame>());
  const [managedDownloads, setManagedDownloads] = useState<DownloadMap>({});
  const [trackedAppIds, setTrackedAppIds] = useState<number[]>([]);
  const [completionQueue, setCompletionQueue] = useState<CompletionEntry[]>([]);
  gamesByAppIdRef.current = new Map(games.flatMap((game) => game.app_id ? [[game.app_id, game] as const] : []));
  const effectiveDownloads = useMemo(() => ({ ...downloads, ...managedDownloads }), [downloads, managedDownloads]);
  const enqueueCompletion = useCallback((record: DownloadJobRecord | null) => {
    if (!record) return;
    const game = gamesByAppIdRef.current.get(record.app_id);
    if (!game) return;
    setCompletionQueue((current) => current.some((entry) => entry.record.job_id === record.job_id) ? current : [...current, { record, game }]);
  }, []);

  const persistCompletion = useCallback(async (appId: number) => {
    try { enqueueCompletion(await recordDownloadCompletion(appId)); } catch { /* retry through pending scan */ }
  }, [enqueueCompletion]);
  useEffect(() => {
    const requested = (event: Event) => {
      const { appId } = (event as CustomEvent<DownloadEventDetail>).detail ?? {};
      if (!appId) return;
      requestStartedAtRef.current.set(appId, Date.now());
      missingPollsRef.current.set(appId, 0);
      activeSeenRef.current.delete(appId);
      setManagedDownloads((current) => ({ ...current, [appId]: downloadManager.requestedStatus(appId) }));
      setTrackedAppIds((current) => current.includes(appId) ? current : [...current, appId]);
    };
    const failed = (event: Event) => {
      const { appId } = (event as CustomEvent<DownloadEventDetail>).detail ?? {};
      if (!appId) return;
      void cancelDownloadLifecycle(appId).catch(() => undefined);
      requestStartedAtRef.current.delete(appId);
      missingPollsRef.current.delete(appId);
      activeSeenRef.current.delete(appId);
      setTrackedAppIds((current) => current.filter((id) => id !== appId));
      setManagedDownloads((current) => {
        const next = { ...current };
        delete next[appId];
        return next;
      });
    };
    window.addEventListener(DOWNLOAD_REQUESTED_EVENT, requested);
    window.addEventListener(DOWNLOAD_REQUEST_FAILED_EVENT, failed);
    return () => {
      window.removeEventListener(DOWNLOAD_REQUESTED_EVENT, requested);
      window.removeEventListener(DOWNLOAD_REQUEST_FAILED_EVENT, failed);
    };
  }, []);

  useEffect(() => {
    const discovered = Object.values(downloads).filter((status) => downloadManager.isTracked(status)).map((status) => status.app_id);
    if (!discovered.length) return;
    const now = Date.now();
    for (const appId of discovered) {
      if (!requestStartedAtRef.current.has(appId)) requestStartedAtRef.current.set(appId, now);
      activeSeenRef.current.add(appId);
    }
    setTrackedAppIds((current) => [...current, ...discovered.filter((appId) => !current.includes(appId))]);
  }, [downloads]);

  useEffect(() => {
    if (getCatalogMode() === "digital") return;
    if (!trackedAppIds.length) return;
    let cancelled = false;
    let timer: number | null = null;

    const release = (appId: number) => {
      requestStartedAtRef.current.delete(appId);
      activeSeenRef.current.delete(appId);
      missingPollsRef.current.delete(appId);
      setTrackedAppIds((current) => current.filter((id) => id !== appId));
    };

    const probeOne = async (appId: number) => {
      const status = await steamDownloadStatus(appId) as ManagedDownloadStatus;
      if (cancelled) return;
      if (gameStateManager.isDownloadComplete(status)) {
        setManagedDownloads((current) => ({ ...current, [appId]: status }));
        release(appId);
        await persistCompletion(appId);
        return;
      }
      if (status.state === "cancelled") {
        setManagedDownloads((current) => ({ ...current, [appId]: status }));
        release(appId);
        await cancelDownloadLifecycle(appId).catch(() => undefined);
        return;
      }
      if (status.error) {
        setManagedDownloads((current) => ({ ...current, [appId]: status }));
        release(appId);
        await cancelDownloadLifecycle(appId).catch(() => undefined);
        return;
      }
      if (downloadManager.isTracked(status) && status.state !== "requested") {
        activeSeenRef.current.add(appId);
        missingPollsRef.current.set(appId, 0);
        setManagedDownloads((current) => ({ ...current, [appId]: status }));
        return;
      }
      if (status.state !== "not-installed") return;
      const missingPolls = (missingPollsRef.current.get(appId) ?? 0) + 1;
      missingPollsRef.current.set(appId, missingPolls);
      const elapsed = Date.now() - (requestStartedAtRef.current.get(appId) ?? Date.now());
      if (!downloadManager.shouldReleaseMissing(status, activeSeenRef.current.has(appId), missingPolls, elapsed)) return;
      setManagedDownloads((current) => ({ ...current, [appId]: status }));
      release(appId);
    };

    const probe = async () => {
      await Promise.all(trackedAppIds.map((appId) => probeOne(appId).catch(() => undefined)));
      if (!cancelled) timer = window.setTimeout(() => void probe(), 2500);
    };
    void probe();
    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [trackedAppIds, persistCompletion]);

  useEffect(() => {
    for (const [rawAppId, status] of Object.entries(effectiveDownloads)) {
      const appId = Number(rawAppId);
      const previousState = previousDownloadStatesRef.current.get(appId);
      if (downloadManager.didJustComplete(previousState, status)) void persistCompletion(appId);
      previousDownloadStatesRef.current.set(appId, status.state);
    }
  }, [effectiveDownloads, persistCompletion]);

  useEffect(() => {
    if (!games.length) return;
    let cancelled = false;
    let timer: number | null = null;
    const refresh = async () => {
      try {
        const records = await pendingDownloadCompletions();
        if (!cancelled) records.forEach(enqueueCompletion);
      } catch { /* runtime store can retry */ }
      if (!cancelled) timer = window.setTimeout(() => void refresh(), 4000);
    };
    void refresh();
    return () => { cancelled = true; if (timer !== null) window.clearTimeout(timer); };
  }, [games.length, enqueueCompletion]);

  return { managedDownloads, setManagedDownloads, trackedAppIds, setTrackedAppIds,
    completionQueue, setCompletionQueue, effectiveDownloads, persistCompletion };
}
