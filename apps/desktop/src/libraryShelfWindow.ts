/**
 * Pure geometry for the library shelf's virtual window. Kept free of React and
 * of DOM measurement so the arithmetic can be tested directly: getting the
 * spacers wrong is what makes the scrollbar jump or the scroll stop moving.
 */

export interface ShelfWindowMetrics {
  /** Grid columns resolved from the rendered cards. */
  columns: number;
  /** Card height plus the row gap, in CSS pixels. */
  rowHeight: number;
  /** Distance from the top of the scroll content to the grid's first row. */
  gridOffsetTop: number;
}

export interface ShelfWindow {
  startIndex: number;
  endIndex: number;
  paddingTop: number;
  paddingBottom: number;
}

/**
 * Choose the slice of cards to mount for the current scroll position.
 *
 * The mounted rows plus the two spacers always account for every row of the
 * list, so the scrollable height never depends on which slice is mounted.
 * `maxCards` is applied as a hard ceiling on the rendered card count.
 */
export function computeShelfWindow(input: {
  scrollTop: number;
  viewportHeight: number;
  totalCount: number;
  metrics: ShelfWindowMetrics;
  maxCards: number;
  /**
   * Floor applied only while the grid is still unmeasured (server render and
   * first paint). Without it a default viewport guess would mount a full
   * window before the real viewport is known, defeating the preview.
   */
  previewLimit?: number;
  /**
   * Rows mounted above and below the visible ones. Without it the window fills `maxCards` and splits the spare rows
   * evenly; with it only the visible rows plus this margin are mounted (still never more than `maxCards`).
   */
  bufferRows?: number;
}): ShelfWindow {
  const { scrollTop, viewportHeight, totalCount, metrics, maxCards, previewLimit } = input;
  const columns = Math.max(1, Math.floor(metrics.columns));
  const rowHeight = Math.max(1, metrics.rowHeight);
  const empty: ShelfWindow = { startIndex: 0, endIndex: 0, paddingTop: 0, paddingBottom: 0 };
  if (totalCount <= 0) return empty;

  const totalRows = Math.ceil(totalCount / columns);
  const gridScrollTop = Math.max(0, scrollTop - metrics.gridOffsetTop);
  const firstVisibleRow = Math.floor(gridScrollTop / rowHeight);

  // Never let the window itself exceed the card ceiling, however short the
  // viewport is: the cap is on rendered nodes, not on visible rows.
  const maxRows = Math.max(1, Math.min(totalRows, Math.floor(Math.max(columns, maxCards) / columns)));
  const unmeasured = previewLimit !== undefined;
  const visibleRows = unmeasured
    ? Math.max(1, Math.ceil(previewLimit / columns))
    : Math.max(1, Math.ceil(viewportHeight / rowHeight));
  const tight = input.bufferRows !== undefined && !unmeasured;
  const bufferRows = tight ? Math.max(0, Math.floor(input.bufferRows!)) : Math.max(0, Math.floor((maxRows - visibleRows) / 2));
  // A partly visible row at the bottom counts as visible too.
  const windowRows = tight ? Math.max(1, Math.min(maxRows, visibleRows + 1 + bufferRows * 2)) : maxRows;

  let startRow = Math.max(0, firstVisibleRow - bufferRows);
  if (startRow + windowRows > totalRows) startRow = Math.max(0, totalRows - windowRows);
  const endRow = Math.min(totalRows - 1, startRow + windowRows - 1);

  const startIndex = startRow * columns;
  const endIndex = unmeasured
    ? Math.min(totalCount, startIndex + previewLimit)
    : Math.min(totalCount, (endRow + 1) * columns);
  return {
    startIndex,
    endIndex,
    paddingTop: startRow * rowHeight,
    paddingBottom: Math.max(0, (totalRows - 1 - endRow) * rowHeight),
  };
}
