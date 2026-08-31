import { describe, expect, it } from "vitest";

import { safeSteamRestoreMode } from "./steamRestorePolicy";

describe("safeSteamRestoreMode", () => {
  it("keeps an explicit leave preference", () => {
    expect(safeSteamRestoreMode("leave", "main-account", true)).toBe("leave");
  });

  it("allows previous-account restoration only with an enrolled credential", () => {
    expect(safeSteamRestoreMode("previous", "previous-account", true)).toBe("previous");
    expect(safeSteamRestoreMode("previous", "previous-account", false)).toBe("leave");
  });

  it("does not attempt restoration when no target account is available", () => {
    expect(safeSteamRestoreMode("main", null, true)).toBe("leave");
    expect(safeSteamRestoreMode("previous", "", true)).toBe("leave");
  });
});
