import { describe, expect, it } from "vitest";

import { resolveSteamInstallOwner } from "./steamOwnership";

describe("resolveSteamInstallOwner", () => {
  it("prefers the active verified owner", () => {
    const owner = resolveSteamInstallOwner(
      [
        { label: "owner-one", account_name: "owner_one", app_ids: [440], active: false },
        { label: "owner-two", account_name: "owner_two", app_ids: [440], active: true },
      ],
      440,
    );

    expect(owner).toBe("owner_two");
  });

  it("ignores Family-visible access when the account does not own the license", () => {
    const owner = resolveSteamInstallOwner(
      [
        {
          label: "borrower",
          account_name: "borrower",
          app_ids: [],
          accessible_app_ids: [570],
          active: true,
        },
        { label: "real-owner", account_name: "real_owner", app_ids: [570], active: false },
      ],
      570,
    );

    expect(owner).toBe("real_owner");
  });

  it("falls back to the remembered display label", () => {
    const owner = resolveSteamInstallOwner(
      [{ label: "Remembered Owner", account_name: "", app_ids: [730], active: true }],
      730,
    );

    expect(owner).toBe("Remembered Owner");
  });

  it("rejects installs without a verified original owner", () => {
    expect(() =>
      resolveSteamInstallOwner(
        [{ label: "borrower", account_name: "borrower", app_ids: [], accessible_app_ids: [400] }],
        400,
      ),
    ).toThrow(/No verified original owner/);
  });
});
