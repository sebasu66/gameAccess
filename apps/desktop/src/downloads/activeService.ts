import { digitalDownloadService, type DigitalDownloadService } from "../catalog/DigitalDownloadService";
import { demoDownloadService } from "../devDemo/demoDownloads";
import { uiDemo } from "../devDemo/uiDemo";

let demo: DigitalDownloadService | undefined;

/** The downloads the app shows: the real service, or the walking demo in the browser preview (`?uiDemo=1`, dev only). */
export function activeDownloadService(): DigitalDownloadService {
  if (import.meta.env.DEV && uiDemo()) return demo ??= demoDownloadService();
  return digitalDownloadService;
}
