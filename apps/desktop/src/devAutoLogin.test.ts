/**
 * Development auto-login.
 *
 * The contract worth pinning is the negative one: a normal installation has no
 * `.env`, and the gate must behave exactly as it does today. The convenience must
 * never turn "no key configured" into a visible failure, and it must never
 * override a session the server already accepted.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

const narrate = vi.fn();
vi.mock("./narrationLog", () => ({ narrate: (...args: unknown[]) => narrate(...args) }));

const invoke = vi.fn();
let tauriRuntime = true;
vi.mock("./native", () => ({ hasTauriRuntime: () => tauriRuntime }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invoke(...args) }));

import { DEV_KEY_NAME, devAutoLoginKey, readDevActivationKey } from "./devAutoLogin";

beforeEach(() => {
  invoke.mockReset();
  narrate.mockReset();
  tauriRuntime = true;
});

describe("reading the development key", () => {
  it("uses the name the Rust side reads", () => {
    // The two sides have to agree on this string; it is the only coupling.
    expect(DEV_KEY_NAME).toBe("devKEY");
  });

  it("returns the key the desktop runtime reports", async () => {
    invoke.mockResolvedValue("4780Sebasu");
    await expect(readDevActivationKey()).resolves.toBe("4780Sebasu");
    expect(invoke).toHaveBeenCalledWith("read_dev_activation_key");
  });

  it("trims what it reads, so a stray space is not part of the key", async () => {
    invoke.mockResolvedValue("  4780Sebasu  ");
    await expect(readDevActivationKey()).resolves.toBe("4780Sebasu");
  });

  it("treats an absent key as nothing to do, not as an error", async () => {
    // No `.env`, no entry, or an empty value all mean the same thing.
    invoke.mockResolvedValue(null);
    await expect(readDevActivationKey()).resolves.toBeNull();
    invoke.mockResolvedValue("");
    await expect(readDevActivationKey()).resolves.toBeNull();
    invoke.mockResolvedValue("   ");
    await expect(readDevActivationKey()).resolves.toBeNull();
  });

  it("does not fail the app when the file cannot be read", async () => {
    invoke.mockRejectedValue(new Error("Cannot read .env"));
    await expect(readDevActivationKey()).resolves.toBeNull();
    // It is reported to the developer, not to the user.
    expect(narrate).toHaveBeenCalled();
  });

  it("does nothing outside the desktop runtime", async () => {
    // The browser build has no filesystem, so it must not even try.
    tauriRuntime = false;
    await expect(readDevActivationKey()).resolves.toBeNull();
    expect(invoke).not.toHaveBeenCalled();
  });
});

describe("deciding whether to auto sign in", () => {
  it("hands back the key when no session is active", async () => {
    invoke.mockResolvedValue("4780Sebasu");
    await expect(devAutoLoginKey(false)).resolves.toBe("4780Sebasu");
  });

  it("stays out of the way when a session is already active", async () => {
    invoke.mockResolvedValue("4780Sebasu");
    await expect(devAutoLoginKey(true)).resolves.toBeNull();
    // It must not even read the file, let alone re-send the key.
    expect(invoke).not.toHaveBeenCalled();
  });

  it("has nothing to do without a key", async () => {
    invoke.mockResolvedValue(null);
    await expect(devAutoLoginKey(false)).resolves.toBeNull();
  });
});
