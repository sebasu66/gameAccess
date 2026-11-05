/**
 * Style flavors (docs/GUI_DESIGN.md §0c): a flavor is one stylesheet of `:root[data-ga-flavor="name"]` that redefines the
 * look's tokens. This turns one on; null is the current look, "terminal".
 */
export function setStyleFlavor(name: string | null): void {
  if (name) document.documentElement.dataset.gaFlavor = name;
  else delete document.documentElement.dataset.gaFlavor;
}
export const styleFlavor = (): string | null => document.documentElement.dataset.gaFlavor ?? null;
