import type { DownloadProgressSnapshot } from "./downloadProvider";

const clamp = (value: number) => (Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0);

/**
 * The two bars of the downloads panel: how much has been downloaded and how much has been installed
 * (extracted). A finished download is not a playable game, so the installation bar only fills while
 * the files are being unpacked and reaches 100 together with the "completed" phase.
 *
 * Snapshots written by an older launcher only carry the combined progress (download = 0-50,
 * installation = 50-100); that scale is converted here.
 */
export function downloadBars(snapshot: Pick<DownloadProgressSnapshot, "phase" | "progress" | "downloadPercent" | "installPercent">): { download: number; install: number } {
  if (snapshot.phase === "completed") return { download: 100, install: 100 };
  if (typeof snapshot.downloadPercent === "number" || typeof snapshot.installPercent === "number") {
    return { download: clamp(snapshot.downloadPercent ?? 0), install: clamp(snapshot.installPercent ?? 0) };
  }
  const combined = clamp(snapshot.progress);
  if (snapshot.phase === "decompressing" || snapshot.phase === "installing") return { download: 100, install: clamp((combined - 50) * 2) };
  if (snapshot.phase === "downloading") return { download: clamp(combined * 2), install: 0 };
  return { download: combined >= 50 ? 100 : clamp(combined * 2), install: combined > 50 ? clamp((combined - 50) * 2) : 0 };
}
