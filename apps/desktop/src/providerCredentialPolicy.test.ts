import { describe, expect, it } from "vitest";
import nativeSource from "./native.ts?raw";

describe("provider credential failure policy", () => {
  it("reports only explicit InvalidPassword download errors to the backend", () => {
    expect(nativeSource).toContain("isExplicitInvalidPassword");
    expect(nativeSource).toContain('includes("invalidpassword")');
    expect(nativeSource).toContain("/downloads/provider-credential-invalid");
    expect(nativeSource).toContain('error_code: "InvalidPassword"');
  });

  it("does not use generic download failures as provider invalidation", () => {
    expect(nativeSource).toContain("if (!providerId || !isExplicitInvalidPassword(error)) return");
  });
});
