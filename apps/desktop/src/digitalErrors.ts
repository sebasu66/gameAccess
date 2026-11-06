import { translate } from "./i18n";
import type { DownloadProgressSnapshot } from "./downloadProvider";

export function digitalErrorMessage(snapshot: DownloadProgressSnapshot, name?: string): string {
  return `Digital AppID ${snapshot.gameId}${name ? " · " + name : ""} · ${snapshot.phase}: ${snapshot.error || snapshot.statusText || translate("digitalErrorFallback")}`;
}
