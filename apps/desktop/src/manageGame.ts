/**
 * "Manage" a game (the detail's main button while it downloads, its "…" menu): a game with a download that is not over
 * (queued, downloading, paused, cancelling, or stopped with a decision pending) is managed in Library › Downloads,
 * where pausing, cancelling and retrying are; any other game in its row of the library manager (Seba, 2026-11-16).
 */
import { activeDownloadService } from "./downloads/activeService";
import { openSection } from "./gameArea";
import { openLibraryManager } from "./libraryManagerNav";
import { selectNavigationTab } from "./navigation/navigationSelection";

const OVER = new Set(["completed", "cancelled", "external"]);

/** The download of this game that is not over, if any. */
export function pendingDownload(appId: number | null | undefined, gameId?: number) {
  return activeDownloadService().getDownloads().find(({ game, snapshot }) => !OVER.has(snapshot.phase)
    && ((appId != null && (game.app_id === appId || snapshot.gameId === appId)) || (gameId != null && (game.id === gameId || snapshot.gameId === gameId))));
}

export function manageGame(appId: number | null | undefined, gameId?: number): void {
  const download = pendingDownload(appId, gameId);
  if (!download) { openLibraryManager(appId ?? undefined); return; }
  // The submode that lists it: a queued or paused one waits in the queue; the rest are in progress.
  selectNavigationTab("library", "downloads", ["queued", "paused"].includes(download.snapshot.phase) ? "queued" : "active");
  openSection("downloads");
}
