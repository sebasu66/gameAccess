export const DESKTOP_IDLE_TIMEOUT_MS = 7 * 60 * 1000;
export const HIGH_FREQUENCY_ACTIVITY_TRAILING_MS = 120;

export const IMMEDIATE_ACTIVITY_EVENTS = ["pointerdown", "touchstart", "keydown"] as const;
export const HIGH_FREQUENCY_ACTIVITY_EVENTS = ["pointermove", "wheel"] as const;

export function idleDeadline(lastActivityAt: number): number {
  return lastActivityAt + DESKTOP_IDLE_TIMEOUT_MS;
}

export function remainingIdleMs(lastActivityAt: number, now: number): number {
  return Math.max(0, idleDeadline(lastActivityAt) - now);
}
