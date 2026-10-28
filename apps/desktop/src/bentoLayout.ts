/**
 * Layout of the library "bento" grid (docs/TAREA-interfaz-nueva.md T7). Installed, playable games are portrait
 * covers; games in the library that are not installed are small landscape images; one portrait takes the space of
 * three landscapes stacked. The grid is built in bands of three rows: each band cell holds a portrait or a stack of
 * up to three landscapes. Portraits are spread evenly among the stacks, the incomplete stack goes last, and deep-frozen
 * games (archived, still installed) keep the portrait size and are grouped in the right-hand column.
 */
export type BentoKind = "ready" | "pending" | "deep";
export interface BentoItem<T> { kind: BentoKind; value: T }
export interface BentoPlacement<T> { value: T; kind: BentoKind; column: number; row: number; rowSpan: number; /** Portrait columns it spans (1 when absent); a featured game in big picture spans several. */ span?: number }

function stacks<T>(list: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += 3) out.push(list.slice(i, i + 3));
  return out;
}

/** Orders the cells: portraits spread among full landscape stacks, the incomplete stack last. */
export function bentoCells<T>(ready: T[], pending: T[]): Array<{ kind: "ready" | "pending"; values: T[] }> {
  const pendingStacks = stacks(pending);
  const partial = pendingStacks.length && pendingStacks[pendingStacks.length - 1].length < 3 ? pendingStacks.pop()! : null;
  const total = ready.length + pendingStacks.length;
  const cells: Array<{ kind: "ready" | "pending"; values: T[] }> = [];
  let r = 0, s = 0;
  for (let k = 0; k < total; k++) {
    const portraitHere = Math.floor((k + 1) * ready.length / total) > Math.floor(k * ready.length / total);
    if (portraitHere && r < ready.length) cells.push({ kind: "ready", values: [ready[r++]] });
    else if (s < pendingStacks.length) cells.push({ kind: "pending", values: pendingStacks[s++] });
    else cells.push({ kind: "ready", values: [ready[r++]] });
  }
  if (partial) cells.push({ kind: "pending", values: partial });
  return cells;
}

/** Explicit grid positions (1-based column and row) for every game, for a grid of `columns` columns. */
export function bentoLayout<T>(items: BentoItem<T>[], columns: number): BentoPlacement<T>[] {
  const cols = Math.max(1, Math.floor(columns));
  const ready = items.filter(item => item.kind === "ready").map(item => item.value);
  const pending = items.filter(item => item.kind === "pending").map(item => item.value);
  const deep = items.filter(item => item.kind === "deep").map(item => [item.value]);
  const cells = bentoCells(ready, pending);
  const bands = Math.max(1, Math.ceil((cells.length + deep.length) / cols));
  const taken = new Set<string>();
  const out: BentoPlacement<T>[] = [];
  const place = (kind: BentoKind, values: T[], band: number, column: number) => {
    taken.add(`${band}:${column}`);
    const row = band * 3 + 1;
    values.forEach((value, index) => out.push(kind !== "pending"
      ? { value, kind, column: column + 1, row, rowSpan: 3 }
      : { value, kind, column: column + 1, row: row + index, rowSpan: 1 }));
  };
  // Archived games fill the right-hand column from the top, then the next one to its left.
  deep.forEach((values, index) => place("deep", values, index % bands, Math.max(0, cols - 1 - Math.floor(index / bands))));
  let position = 0;
  for (const cell of cells) {
    while (taken.has(`${Math.floor(position / cols)}:${position % cols}`)) position++;
    place(cell.kind, cell.values, Math.floor(position / cols), position % cols);
    position++;
  }
  return out;
}

/**
 * Big picture mode's bento (only ready games): the favourite and most played games are wide, landscape cards; the
 * others are portraits around them. Every line is one portrait tall; a wide card spans `wide` portrait columns, which
 * with three is about the shape of Steam's header picture (460 × 215). Each line has at most one wide card, on the left
 * and on the right in turn; the portraits fill the rest. When the portraits run out, the remaining wide cards go side
 * by side. Below the divider (row 1), lines start at row 2.
 */
export function bigPictureBento<T>(featured: T[], regular: T[], columns: number, wide = 3): { placements: BentoPlacement<T>[]; tracks: BentoTrack[] } {
  const cols = Math.max(1, Math.floor(columns));
  const span = Math.min(wide, cols - 1);
  // Too narrow for a wide card next to anything: everything is a portrait.
  const tall = span < 2 ? [...featured, ...regular] : regular;
  const big = span < 2 ? [] : featured;
  const placements: BentoPlacement<T>[] = [];
  const tracks: BentoTrack[] = ["label"];
  let f = 0, r = 0, line = 0;
  while (f < big.length || r < tall.length) {
    const row = 2 + line * 3;
    const put = (kind: "ready", value: T, column: number, width: number) => placements.push({ value, kind, column, row, rowSpan: 3, ...(width > 1 ? { span: width } : {}) });
    let first = 1, last = cols;
    if (f < big.length) {
      if (line % 2 === 0) { put("ready", big[f++], 1, span); first = span + 1; }
      else { put("ready", big[f++], cols - span + 1, span); last = cols - span; }
    }
    for (let column = first; column <= last;) {
      if (r < tall.length) { put("ready", tall[r++], column, 1); column++; }
      else if (f < big.length && last - column + 1 >= span) { put("ready", big[f++], column, span); column += span; }
      else break;
    }
    tracks.push("row", "row", "row");
    line++;
  }
  return { placements, tracks };
}

export interface PlayRecord { liked: boolean; plays: number; lastPlayed: number }
/**
 * The games big picture mode shows wide: the ones the player liked or plays the most, about a quarter of them (at
 * least one when any qualifies, none among fewer than three games). Liked games come first, then by plays and by the
 * last time played. A game never liked nor played is never featured.
 */
export function featuredGames<T>(games: T[], record: (game: T) => PlayRecord, share = 0.25): Set<T> {
  if (games.length < 3) return new Set();
  const limit = Math.max(1, Math.round(games.length * share));
  const ranked = games.map(game => ({ game, ...record(game) })).filter(item => item.liked || item.plays > 0)
    .sort((a, b) => Number(b.liked) - Number(a.liked) || b.plays - a.plays || b.lastPlayed - a.lastPlayed);
  return new Set(ranked.slice(0, limit).map(item => item.game));
}

/** Row height that makes three landscape rows plus two gaps as tall as one portrait (2:3) column. */
export function bentoRowHeight(columnWidth: number, gap: number): number {
  return Math.max(40, (columnWidth * 1.5 - 2 * gap) / 3);
}

export interface BentoSectionMark { kind: BentoKind; row: number; count: number; collapsed: boolean }
/** "row": a third of a portrait; "wide": a row of landscape games to install, as tall as their picture. */
export type BentoTrack = "label" | "row" | "wide";

/**
 * The library grouped by kind, one under the other, each under a thin divider: installed games (portrait), then
 * deep-frozen ones (portrait), then games to install (landscape, one row each). Every kind keeps the order it came in.
 * Rows are absolute in one grid: `tracks` says what each row is ("label" rows hold a divider, "row" rows a card row),
 * so cards can still move between groups (a finished download) with the same Flip animation. A collapsed group (an
 * accordion) keeps its divider, with the count, and places no cards. Games to install are laid out `wideColumns` to a
 * line (their own, wider slots: column numbers count those slots), one "wide" row per line.
 */
export function bentoSections<T>(items: BentoItem<T>[], columns: number, collapsed: ReadonlySet<BentoKind> = new Set(), wideColumns = columns): { placements: BentoPlacement<T>[]; sections: BentoSectionMark[]; tracks: BentoTrack[] } {
  const cols = Math.max(1, Math.floor(columns));
  const placements: BentoPlacement<T>[] = [];
  const sections: BentoSectionMark[] = [];
  const tracks: BentoTrack[] = [];
  let row = 1;
  for (const kind of ["ready", "deep", "pending"] as const) {
    const group = items.filter(item => item.kind === kind);
    if (!group.length) continue;
    const closed = collapsed.has(kind);
    sections.push({ kind, row, count: group.length, collapsed: closed });
    tracks.push("label");
    row++;
    if (closed) continue;
    const portrait = kind !== "pending";
    const perLine = portrait ? cols : Math.max(1, Math.floor(wideColumns));
    const lines = Math.ceil(group.length / perLine);
    group.forEach((item, index) => placements.push({ value: item.value, kind, column: (index % perLine) + 1, row: row + Math.floor(index / perLine) * (portrait ? 3 : 1), rowSpan: portrait ? 3 : 1 }));
    const used = lines * (portrait ? 3 : 1);
    for (let i = 0; i < used; i++) tracks.push(portrait ? "row" : "wide");
    row += used;
  }
  return { placements, sections, tracks };
}

/**
 * Top of every grid row in pixels (index = row - 1), for a grid whose label rows have no height of their own, whose
 * card rows are `rowHeight` tall and wide rows `wideHeight`, all separated by `gap`. The library mounts only the cards
 * near the screen from it.
 */
export function bentoRowTops(tracks: BentoTrack[], rowHeight: number, gap: number, wideHeight = rowHeight): number[] {
  const tops: number[] = [];
  let y = 0;
  for (const track of tracks) {
    tops.push(y);
    y += (track === "label" ? 0 : track === "wide" ? wideHeight : rowHeight) + gap;
  }
  return tops;
}

/** The placements that touch the band [from, to] (pixels from the top of the grid): the sliding window of cards. */
export function bentoInWindow<T>(placements: BentoPlacement<T>[], tops: number[], rowHeight: number, from: number, to: number, wideHeight = rowHeight): BentoPlacement<T>[] {
  return placements.filter(item => {
    const top = tops[item.row - 1] ?? 0;
    const bottom = (tops[item.row + item.rowSpan - 2] ?? top) + (item.kind === "pending" ? wideHeight : rowHeight);
    return bottom >= from && top <= to;
  });
}
