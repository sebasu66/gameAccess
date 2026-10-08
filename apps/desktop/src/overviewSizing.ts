export const OVERVIEW_ZOOM_KEY = "gameaccess:overview-zoom:v1";
export function normalizeOverviewZoom(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(160, Math.max(100, Math.round(value))) : 100;
}
export function loadOverviewZoom(): number {
  try { return normalizeOverviewZoom(JSON.parse(localStorage.getItem(OVERVIEW_ZOOM_KEY) || "null")); }
  catch { return 100; }
}
export function saveOverviewZoom(value: number): void {
  try { localStorage.setItem(OVERVIEW_ZOOM_KEY, JSON.stringify(normalizeOverviewZoom(value))); }
  catch { /* Live zoom remains usable when storage is unavailable. */ }
}
export function overviewCoverSizing(width: number, height: number, availableWidth: number, count: number, zoom = 100) {
  const resultCount = Math.max(1, Math.min(50, count));
  const gap = width < 760 ? 16 : 28;
  const baseMinimum = width >= 1800 ? 210 : width <= 760 ? 138 : width <= 1100 ? 160 : 173;
  const baseColumns = Math.max(1, Math.floor((availableWidth + gap) / (baseMinimum + gap)));
  const baseline = (availableWidth - gap * (baseColumns - 1)) / baseColumns;
  const scale = resultCount <= 5 ? 1.5 : resultCount <= 20 ? 1 + (20 - resultCount) / 30 : 1 - (resultCount - 20) * .23 / 30;
  const maximum = Math.max(132, Math.min(360, baseline * 1.5, (height - 270) * 2 / 3));
  // Preserve automatic result/viewport sizing, then apply the new 10% base and user zoom.
  const automaticFloor = Math.max(132, Math.min(maximum, baseline * scale));
  const coverFloor = Math.min(availableWidth, automaticFloor * 1.1 * normalizeOverviewZoom(zoom) / 100);
  const coverColumns = Math.min(resultCount, Math.max(1, Math.floor((availableWidth + gap) / (coverFloor + gap))));
  return { coverFloor, coverColumns };
}
