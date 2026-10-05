import { describe, expect, it } from "vitest";
import gateSource from "./ActivationGate.tsx?raw";
import i18nSource from "./i18n.ts?raw";
import {
  ACTIVATION_TIMER_SLICE_MS,
  ACTIVATION_WARNING_MS,
  nextActivationTimerDelay,
} from "./activationLifetime";

describe("activation lifetime UX", () => {
  it("warns ten minutes before the key expires", () => {
    expect(ACTIVATION_WARNING_MS).toBe(10 * 60 * 1000);
    expect(gateSource).toContain('t("activationExpiringSoon")');
    expect(i18nSource).toContain("Tu acceso expirará en 10 minutos");
  });

  it("returns to the activation gate when access time ends", () => {
    expect(gateSource).toContain("clearActivationSession");
    expect(gateSource).toContain("setStatus(null)");
    expect(gateSource).toContain('t("activationTimeEnded")');
    expect(i18nSource).toContain("Terminó el tiempo de acceso");
  });

  it("never schedules a one-month timeout directly", () => {
    const thirtyOneDays = 31 * 24 * 60 * 60 * 1000;
    const browserSignedTimeoutLimit = 2_147_483_647;

    const delay = nextActivationTimerDelay(thirtyOneDays);

    expect(delay).toBe(ACTIVATION_TIMER_SLICE_MS);
    expect(delay).toBeLessThan(browserSignedTimeoutLimit);
    expect(delay).toBeLessThan(thirtyOneDays);
  });

  it("schedules the final expiry directly once inside the warning window", () => {
    expect(nextActivationTimerDelay(5 * 60 * 1000)).toBe(5 * 60 * 1000);
  });
});
