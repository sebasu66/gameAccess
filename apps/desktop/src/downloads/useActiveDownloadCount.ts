import { useEffect, useState } from "react";
import { isDownloadHistory } from "../catalog/DigitalDownloadService";
import type { DownloadProgressSnapshot } from "../downloadProvider";
import { activeDownloadService } from "./activeService";

export type ActiveDownloads = { count: number; speedBps: number };

/** Downloads that have not ended (queued, preparing, downloading, paused, unpacking) and their speed together. */
export function readActiveDownloads(entries: readonly { snapshot: Pick<DownloadProgressSnapshot, "phase" | "speedBps"> }[]): ActiveDownloads {
  const active = entries.filter(entry => !isDownloadHistory(entry.snapshot.phase));
  return { count: active.length, speedBps: active.reduce((sum, entry) => sum + (entry.snapshot.speedBps ?? 0), 0) };
}

/** The active downloads, updated as they move (the status bar's count and speed). */
export function useActiveDownloads(): ActiveDownloads {
  const read = () => readActiveDownloads(activeDownloadService().getDownloads());
  const [state, setState] = useState(read);
  useEffect(() => {
    const service = activeDownloadService();
    const update = () => {
      const next = read();
      setState(previous => previous.count === next.count && previous.speedBps === next.speedBps ? previous : next);
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
