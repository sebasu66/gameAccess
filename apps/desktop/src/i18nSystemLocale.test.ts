import { describe, expect, it } from "vitest";
import { localeFromSystem } from "./i18n";

describe("first-run language", () => {
  it("follows the Windows display language when the app speaks it", () => {
    expect(localeFromSystem(["es-AR", "en-US"])).toBe("es");
    expect(localeFromSystem(["en-GB"])).toBe("en");
    expect(localeFromSystem(["de-DE", "en-US"])).toBe("en");
  });

  it("falls back to Spanish when no system language is supported", () => {
    expect(localeFromSystem(["pt-BR"])).toBe("es");
    expect(localeFromSystem([""])).toBe("es");
  });
});
