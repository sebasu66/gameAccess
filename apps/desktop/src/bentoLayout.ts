/**
 * Layout of the library "bento" grid (docs/TAREA-interfaz-nueva.md T7). Installed, playable games are portrait
 * covers; games in the library that are not installed are small landscape images; one portrait takes the space of
 * three landscapes stacked. The grid is built in bands of three rows: each band cell holds a portrait or a stack of
 * up to three landscapes. Portraits are spread evenly among the stacks, the incomplete stack goes last, and deep-frozen
 * games (archived, still installed) keep the portrait size and are grouped in the right-hand column.
 */
export type BentoKind = "ready" | "pending" | "deep";
export interface BentoItem<T> { kind: BentoKind; value: T }
export interface BentoPlacement<T> { value: T; kind: BentoKind; column: number; row: number; rowSpan: number }

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

/** Row height that makes three landscape rows plus two gaps as tall as one portrait (2:3) column. */
export function bentoRowHeight(columnWidth: number, gap: number): number {
  return Math.max(40, (columnWidth * 1.5 - 2 * gap) / 3);
}

export interface BentoSectionMark { kind: BentoKind; row: number; count: number; collapsed: boolean }
export type BentoTrack = "label" | "row";

/**
 * The library grouped by kind, one under the other, each under a thin divider: installed games (portrait), then
 * deep-frozen ones (portrait), then games to install (landscape, one row each). Every kind keeps the order it came in.
 * Rows are absolute in one grid: `tracks` says what each row is ("label" rows hold a divider, "row" rows a card row),
 * so cards can still move between groups (a finished download) with the same Flip animation. A collapsed group (an
 * accordion) keeps its divider, with the count, and places no cards.
 */
export function bentoSections<T>(items: BentoItem<T>[], columns: number, collapsed: ReadonlySet<BentoKind> = new Set()): { placements: BentoPlacement<T>[]; sections: BentoSectionMark[]; tracks: BentoTrack[] } {
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
    const lines = Math.ceil(group.length / cols);
    group.forEach((item, index) => placements.push({ value: item.value, kind, column: (index % cols) + 1, row: row + Math.floor(index / cols) * (portrait ? 3 : 1), rowSpan: portrait ? 3 : 1 }));
    const used = lines * (portrait ? 3 : 1);
    for (let i = 0; i < used; i++) tracks.push("row");
    row += used;
  }
  return { placements, sections, tracks };
}

/**
 * Top of every grid row in pixels (index = row - 1), for a grid whose label rows have no height of their own and whose
 * card rows are `rowHeight` tall, all separated by `gap`. The library mounts only the cards near the screen from it.
 */
export function bentoRowTops(tracks: BentoTrack[], rowHeight: number, gap: number): number[] {
  const tops: number[] = [];
  let y = 0;
  for (const track of tracks) {
    tops.push(y);
    y += (track === "label" ? 0 : rowHeight) + gap;
  }
  return tops;
}

/** The placements that touch the band [from, to] (pixels from the top of the grid): the sliding window of cards. */
export function bentoInWindow<T>(placements: BentoPlacement<T>[], tops: number[], rowHeight: number, from: number, to: number): BentoPlacement<T>[] {
  return placements.filter(item => {
    const top = tops[item.row - 1] ?? 0;
    const bottom = (tops[item.row + item.rowSpan - 2] ?? top) + rowHeight;
    return bottom >= from && top <= to;
  });
}
