import { describe, expect, it } from "vitest";

import {
  DESKTOP_IDLE_TIMEOUT_MS,
  HIGH_FREQUENCY_ACTIVITY_EVENTS,
  IMMEDIATE_ACTIVITY_EVENTS,
  idleDeadline,
  remainingIdleMs,
} from "./desktopIdle";

describe("desktop idle policy", () => {
  it("uses a seven-minute desktop inactivity window", () => {
    expect(DESKTOP_IDLE_TIMEOUT_MS).toBe(7 * 60 * 1000);
    expect(idleDeadline(10_000)).toBe(430_000);
  });

  it("treats pointer movement, wheel, touch, pointer down and keyboard as user activity", () => {
    expect([...IMMEDIATE_ACTIVITY_EVENTS, ...HIGH_FREQUENCY_ACTIVITY_EVENTS]).toEqual(
      expect.arrayContaining(["pointerdown", "pointermove", "wheel", "touchstart", "keydown"]),
    );
  });

  it("visibility restoration receives a complete new period", () => {
    const restoredAt = 500_000;
    expect(remainingIdleMs(restoredAt, restoredAt)).toBe(DESKTOP_IDLE_TIMEOUT_MS);
    expect(remainingIdleMs(restoredAt, restoredAt + DESKTOP_IDLE_TIMEOUT_MS)).toBe(0);
  });
});
