// Catalog cover grid as in the approved demo: columns of at least 176 px, 24 px apart, stretched to fill the row
// (like `repeat(auto-fill, minmax(176px, 1fr))`). A short result list keeps the same cover size instead of growing.
export const COVER_MIN = 176;
export const COVER_GAP = 24;
export function overviewCoverSizing(_width: number, _height: number, availableWidth: number, count: number) {
  const tracks = Math.max(1, Math.floor((availableWidth + COVER_GAP) / (COVER_MIN + COVER_GAP)));
  const coverFloor = Math.min(availableWidth, (availableWidth - COVER_GAP * (tracks - 1)) / tracks);
  const coverColumns = Math.min(Math.max(1, count), tracks);
  return { coverFloor, coverColumns };
}
