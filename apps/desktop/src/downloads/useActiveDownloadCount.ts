import { useEffect, useState } from "react";
import { isDownloadHistory } from "../catalog/DigitalDownloadService";
import type { DownloadProgressSnapshot } from "../downloadProvider";
import { activeDownloadService } from "./activeService";

export type ActiveDownloads = { count: number; queued: number; speedBps: number; cover?: string };

/** A download's wide picture, in the order the downloads screen tries them (DigitalDownloadThumb). */
const wideArt = (game?: { hero_image?: string | null; header_image?: string | null; app_id?: number | null }) =>
  game?.hero_image || game?.header_image || (game?.app_id ? `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${game.app_id}/library_hero.jpg` : undefined);

/** Downloads that have not ended (queued, preparing, downloading, paused, unpacking) and their speed together. */
export function readActiveDownloads(entries: readonly { game?: { hero_image?: string | null; header_image?: string | null; app_id?: number | null }; snapshot: Pick<DownloadProgressSnapshot, "phase" | "speedBps"> }[]): ActiveDownloads {
  const active = entries.filter(entry => !isDownloadHistory(entry.snapshot.phase));
  // The cover of the first one that is moving (the content header's picture, §4.3), else the first in the list.
  const moving = active.find(entry => entry.snapshot.phase !== "queued") ?? active[0];
  return {
    count: active.length, queued: active.filter(entry => entry.snapshot.phase === "queued").length,
    speedBps: active.reduce((sum, entry) => sum + (entry.snapshot.speedBps ?? 0), 0), cover: wideArt(moving?.game),
  };
}

/** The active downloads, updated as they move (the status bar's count and speed). */
export function useActiveDownloads(): ActiveDownloads {
  const read = () => readActiveDownloads(activeDownloadService().getDownloads());
  const [state, setState] = useState(read);
  useEffect(() => {
    const service = activeDownloadService();
    const update = () => {
      const next = read();
      setState(previous => previous.count === next.count && previous.queued === next.queued && previous.speedBps === next.speedBps && previous.cover === next.cover ? previous : next);
    };
    update();
    return service.onGlobalUpdate(update);
  }, []);
  return state;
}

/** How many downloads have not ended: the Downloads section's count. */
export function useActiveDownloadCount(): number {
  return useActiveDownloads().count;
}
