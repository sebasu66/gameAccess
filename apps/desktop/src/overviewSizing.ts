// Catalog cover grid as in the approved demo: columns of at least 176 px, 24 px apart, stretched to fill the row
// (like `repeat(auto-fill, minmax(176px, 1fr))`). A short result list keeps the same cover size instead of growing.
export const COVER_MIN = 176;
export const COVER_GAP = 24;
/** Smallest cover on small windows. */
export const COVER_MIN_SMALL = 120;
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
  const tracks = Math.max(1, Math.floor((availableWidth + COVER_GAP) / (coverMin(width, height) + COVER_GAP)));
  const coverFloor = Math.min(availableWidth, (availableWidth - COVER_GAP * (tracks - 1)) / tracks);
  const coverColumns = Math.min(Math.max(1, count), tracks);
  return { coverFloor, coverColumns };
}
