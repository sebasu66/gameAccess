import { useEffect, useState } from "react";
import { isDownloadHistory } from "../catalog/DigitalDownloadService";
import { activeDownloadService } from "./activeService";

/** How many downloads have not ended (queued, preparing, downloading, paused, unpacking): the Downloads section's count. */
export function useActiveDownloadCount(): number {
  const read = () => activeDownloadService().getDownloads().filter(entry => !isDownloadHistory(entry.snapshot.phase)).length;
  const [count, setCount] = useState(read);
  useEffect(() => {
    const service = activeDownloadService();
    const update = () => setCount(service.getDownloads().filter(entry => !isDownloadHistory(entry.snapshot.phase)).length);
    update();
    return service.onGlobalUpdate(update);
  }, []);
  return count;
}
