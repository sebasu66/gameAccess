import type { DownloadProgressSnapshot } from "./downloadProvider";

export function digitalErrorMessage(snapshot: DownloadProgressSnapshot, name?: string): string {
  return `Digital AppID ${snapshot.gameId}${name ? " · " + name : ""} · ${snapshot.phase}: ${snapshot.error || snapshot.statusText || "Error de ejecución"}`;
}
