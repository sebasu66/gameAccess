// Catalog cover grid as in the approved demo: columns of at least 176 px, 24 px apart, stretched to fill the row
// (like `repeat(auto-fill, minmax(176px, 1fr))`). A short result list keeps the same cover size instead of growing.
export const COVER_MIN = 176;
export const COVER_GAP = 24;
/** Smallest cover on small windows. */
export const COVER_MIN_SMALL = 120;
/** The grid shows at least this many covers across, as long as each stays at least COVER_MIN_TIGHT wide. */
export const GRID_COLUMNS = 6;
export const COVER_MIN_TIGHT = 110;
/** Space between covers, following the window: 24 px on small windows, about 35 px at 1600 px, at most 40 px. */
export function coverGap(width: number): number {
  return width ? Math.round(Math.min(40, Math.max(COVER_GAP, width * .022))) : COVER_GAP;
}
/** How many covers fit across `available` px: as many as fit at `min` px, and never fewer than six that fit at 110 px. */
export function coverTracks(available: number, gap: number, min: number): number {
  const fit = Math.floor((available + gap) / (min + gap));
  const tight = Math.floor((available + gap) / (COVER_MIN_TIGHT + gap));
  return Math.max(1, fit, Math.min(GRID_COLUMNS, tight));
}
/**
 * The narrowest a cover may be, following the window: 176 px from a 1600 px wide window up, smaller below (11 % of
 * the width, and no more than 19 % of the height on short windows), never under 120 px. Small windows show more
 * games at a time instead of a few big covers. `largest` is the size on big windows (the library's grid uses 180).
 */
export function coverMin(width: number, height: number, largest = COVER_MIN): number {
  if (!width || !height) return largest;
  return Math.round(Math.min(largest, Math.max(COVER_MIN_SMALL, Math.min(width * .11, height * .19))));
}
export function overviewCoverSizing(width: number, height: number, availableWidth: number, count: number) {
  const gap = coverGap(width);
  const tracks = coverTracks(availableWidth, gap, coverMin(width, height));
  const coverFloor = Math.min(availableWidth, (availableWidth - gap * (tracks - 1)) / tracks);
  const coverColumns = Math.min(Math.max(1, count), tracks);
  return { coverFloor, coverColumns, coverGap: gap };
}
