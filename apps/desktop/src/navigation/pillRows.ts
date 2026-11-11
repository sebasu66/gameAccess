/**
 * The order the submode pills are drawn in, so the rows fill without gaps (Seba, 2026-11-11): each row takes the
 * first pill still waiting, then every later pill that still fits in what is left of that row, in the tree's order.
 */
export function packPills(widths: readonly number[], room: number, gap: number): number[] {
  const waiting = widths.map((_, index) => index);
  const order: number[] = [];
  while (waiting.length) {
    let left = room - widths[waiting[0]];
    order.push(waiting.shift()!);
    for (let i = 0; i < waiting.length;) {
      const need = gap + widths[waiting[i]];
      if (need <= left) { left -= need; order.push(waiting.splice(i, 1)[0]); } else i += 1;
    }
  }
  return order;
}
