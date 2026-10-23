/**
 * Layout of the library "bento" grid (docs/TAREA-interfaz-nueva.md T7). Installed, playable games are portrait
 * covers; games in the library that are not installed are small landscape images; one portrait takes the space of
 * three landscapes stacked. The grid is built in bands of three rows: each band cell holds a portrait or a stack of
 * up to three landscapes. Portraits are spread evenly among the stacks, the incomplete stack goes last, and deep-frozen
 * games (archived) are grouped in the right-hand column.
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
  const deep = stacks(items.filter(item => item.kind === "deep").map(item => item.value));
  const cells = bentoCells(ready, pending);
  const bands = Math.max(1, Math.ceil((cells.length + deep.length) / cols));
  const taken = new Set<string>();
  const out: BentoPlacement<T>[] = [];
  const place = (kind: BentoKind, values: T[], band: number, column: number) => {
    taken.add(`${band}:${column}`);
    const row = band * 3 + 1;
    values.forEach((value, index) => out.push(kind === "ready"
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
