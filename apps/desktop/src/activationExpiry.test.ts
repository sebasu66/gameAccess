import { describe, expect, it } from "vitest";
import gateSource from "./ActivationGate.tsx?raw";
import i18nSource from "./i18n.ts?raw";

describe("activation lifetime UX", () => {
  it("warns ten minutes before the key expires", () => {
    expect(gateSource).toContain("10 * 60 * 1000");
    expect(gateSource).toContain('t("activationExpiringSoon")');
    expect(i18nSource).toContain("Tu acceso expirará en 10 minutos");
  });

  it("returns to the activation gate when access time ends", () => {
    expect(gateSource).toContain("clearActivationSession");
    expect(gateSource).toContain('setStatus(null)');
    expect(gateSource).toContain('t("activationTimeEnded")');
    expect(i18nSource).toContain("Terminó el tiempo de acceso");
  });
});
