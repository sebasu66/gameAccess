import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import { invoke } from "@tauri-apps/api/core";
import { openSteamInstall } from "./native";

const invokeMock = vi.mocked(invoke);

function status(appId: number, state: "preparing" | "downloading") {
  return {
    app_id: appId,
    state,
    progress: state === "downloading" ? 10 : null,
    bytes_downloaded: null,
    bytes_total: null,
    installed: false,
  };
}

function installRuntime(catalogMode: "local" | "gameaccess") {
  vi.stubGlobal("localStorage", {
    getItem: vi.fn((key: string) => key === "gameaccess:catalog-mode" ? catalogMode : null),
    setItem: vi.fn(),
    removeItem: vi.fn(),
    clear: vi.fn(),
  });
  vi.stubGlobal("window", {
    __TAURI_INTERNALS__: {},
    dispatchEvent: vi.fn(),
    setTimeout,
  });
}

describe("Steam download routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses the provider downloader for the GameAccess catalog", async () => {
    installRuntime("gameaccess");
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "start_provider_download") return status(222, "preparing");
      if (command === "provider_download_status") return status(222, "preparing");
      throw new Error(`unexpected command: ${command}`);
    });

    await openSteamInstall(222);

    expect(invokeMock).toHaveBeenCalledWith("start_provider_download", { appId: 222 });
    expect(invokeMock).not.toHaveBeenCalledWith("local_steam_pool");
    expect(invokeMock).not.toHaveBeenCalledWith("open_steam_install", expect.anything());
  });

  it("keeps the remembered-account Steam install route for the local catalog", async () => {
    installRuntime("local");
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "local_steam_pool") {
        return {
          source: "steam-local-remembered-accounts",
          verification_complete: true,
          verified_at: null,
          games: [{ app_id: 222, name: "Owned Game" }],
          accounts: [{
            label: "Owner",
            account_name: "owner",
            app_ids: [222],
            accessible_app_ids: [222],
            active: true,
          }],
        };
      }
      if (command === "open_steam_install") return undefined;
      if (command === "steam_download_status") return status(222, "downloading");
      throw new Error(`unexpected command: ${command}`);
    });

    await openSteamInstall(222);

    expect(invokeMock).toHaveBeenCalledWith("open_steam_install", { appId: 222 });
    expect(invokeMock).not.toHaveBeenCalledWith("start_provider_download", expect.anything());
  });
});
