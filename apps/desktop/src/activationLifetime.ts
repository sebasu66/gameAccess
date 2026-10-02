export const ACTIVATION_WARNING_MS = 10 * 60 * 1000;

// Browsers clamp/overflow very long setTimeout delays around 2^31-1 ms
// (~24.8 days). Keep timers short and re-evaluate remaining access time.
export const ACTIVATION_TIMER_SLICE_MS = 6 * 60 * 60 * 1000;

export function nextActivationTimerDelay(remainingMs: number): number {
  if (!Number.isFinite(remainingMs) || remainingMs <= 0) return 0;
  const untilNextMeaningfulPoint =
    remainingMs > ACTIVATION_WARNING_MS
      ? remainingMs - ACTIVATION_WARNING_MS
      : remainingMs;
  return Math.max(
    1,
    Math.min(ACTIVATION_TIMER_SLICE_MS, untilNextMeaningfulPoint),
  );
}
