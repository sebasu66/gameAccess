import { useSyncExternalStore } from "react";

/**
 * Steam serves the portrait library capsule in two sizes: 300x450 ("1x") and 600x900 ("2x").
 * The overview grid only needs the larger one when a card is rendered wider than 300 device pixels,
 * so the tier follows the card width (which follows the grid zoom) and the display pixel ratio.
 */
export type CoverTier = "1x" | "2x";

const ONE_X_WIDTH = 300;
const listeners = new Set<() => void>();
let cardWidth = 180;

export function coverTierFor(cssWidth: number, pixelRatio: number): CoverTier {
  return cssWidth * (pixelRatio > 0 ? pixelRatio : 1) <= ONE_X_WIDTH ? "1x" : "2x";
}

const ratio = () => (typeof window === "undefined" ? 1 : window.devicePixelRatio || 1);
let tier: CoverTier = coverTierFor(cardWidth, ratio());

/** Published by the grid whenever its card width changes (zoom, resize, result count). */
export function setCoverCardWidth(width: number): void {
  if (!Number.isFinite(width) || width <= 0) return;
  cardWidth = width;
  const next = coverTierFor(cardWidth, ratio());
  if (next === tier) return;
  tier = next;
  // Deferred: this is called while the grid renders, and subscribers must not update mid-render.
  queueMicrotask(() => listeners.forEach((listener) => listener()));
}

export function currentCoverTier(): CoverTier {
  return tier;
}

export function useCoverTier(): CoverTier {
  return useSyncExternalStore(
    (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    currentCoverTier,
    currentCoverTier,
  );
}
