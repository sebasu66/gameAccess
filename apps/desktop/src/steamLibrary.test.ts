import { describe, expect, it } from "vitest";
import { isSteamOwned, steamOwnerLabel } from "./steamLibrary";
import { libraryMembership } from "./libraryMembership";
import type { LibraryGame } from "./catalog/DigitalProcessManager";
import type { CatalogGame } from "./types";

const row = (extra: Partial<LibraryGame>) => ({ app_id: 10, name: "Alpha", state: "linked", link_kind: "steam", installed: true, ...extra }) as LibraryGame;

describe("Steam library", () => {
  it("only an owned, not installed Steam game is installed through Steam", () => {
    expect(isSteamOwned(row({ state: "steam_owned", installed: false }))).toBe(true);
    expect(isSteamOwned(row({}))).toBe(false);
    expect(isSteamOwned(row({ state: "steam_owned", link_kind: "folder" }))).toBe(false);
    expect(isSteamOwned(undefined)).toBe(false);
  });

  it("names the owner by its display name and account", () => {
    expect(steamOwnerLabel({ id64: "1", account: "acc", persona: "Big One", remembered: true })).toBe("Big One (acc)");
    expect(steamOwnerLabel({ id64: "1", account: "acc", persona: "acc", remembered: true })).toBe("acc");
    expect(steamOwnerLabel({ id64: "765", account: "", persona: "", remembered: false })).toBe("765");
    expect(steamOwnerLabel(undefined)).toBe("");
  });

  it("adds many games at once without repeating the ones already there", () => {
    const before = libraryMembership.getGames().length;
    const games = [{ id: 9001, app_id: 9001, name: "A" }, { id: 9002, app_id: 9002, name: "B" }, { id: 9001, app_id: 9001, name: "A again" }] as CatalogGame[];
    libraryMembership.addMany(games);
    libraryMembership.addMany(games);
    expect(libraryMembership.getGames().length).toBe(before + 2);
    games.forEach(game => libraryMembership.remove(game));
  });
});

describe("continuous Steam sync", () => {
  it("syncs as soon as it is asked (an account linked, a game handed to Steam), then every few minutes and on coming back to the app", async () => {
    const { vi } = await import("vitest");
    const { requestSteamSync, startSteamSync, STEAM_SYNC_EVERY_MS, STEAM_SYNC_FOCUS_GAP_MS } = await import("./steamLibrary");
    vi.useFakeTimers();
    const events = new EventTarget();
    vi.stubGlobal("window", Object.assign(events, { setInterval, clearInterval, addEventListener: events.addEventListener.bind(events), removeEventListener: events.removeEventListener.bind(events), dispatchEvent: events.dispatchEvent.bind(events) }));
    let clock = 0;
    const sync = vi.fn(async () => undefined);
    const stop = startSteamSync({ sync, now: () => clock, getCatalog: () => [{ id: 1 } as CatalogGame] });
    try {
      await vi.advanceTimersByTimeAsync(0);
      expect(sync).not.toHaveBeenCalled();
      requestSteamSync();                                          // asked: Steam is read at once
      await vi.advanceTimersByTimeAsync(0);
      expect(sync).toHaveBeenCalledTimes(1);
      expect(sync).toHaveBeenLastCalledWith([{ id: 1 }]);
      clock += STEAM_SYNC_EVERY_MS;
      await vi.advanceTimersByTimeAsync(STEAM_SYNC_EVERY_MS);     // and again a few minutes later
      expect(sync).toHaveBeenCalledTimes(2);
      window.dispatchEvent(new Event("focus"));                    // just synced: an alt-tab does not read it again
      await vi.advanceTimersByTimeAsync(0);
      expect(sync).toHaveBeenCalledTimes(2);
      clock += STEAM_SYNC_FOCUS_GAP_MS;
      window.dispatchEvent(new Event("focus"));
      await vi.advanceTimersByTimeAsync(0);
      expect(sync).toHaveBeenCalledTimes(3);
    } finally {
      stop(); vi.useRealTimers(); vi.unstubAllGlobals();
    }
  });
});

describe("account libraries in the library list", () => {
  it("a game that left the registered accounts (or whose record the sync just removed) leaves the list", async () => {
    const { vi } = await import("vitest");
    const { digitalProcessManager } = await import("./catalog/DigitalProcessManager");
    const { syncSteamLibrary, STEAM_MEMBERS_KEY } = await import("./steamLibrary");
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => void store.set(key, value), removeItem: (key: string) => void store.delete(key) });
    const game = (id: number) => ({ id, app_id: id, name: `G${id}` }) as CatalogGame;
    [9101, 9102, 9103].forEach(id => libraryMembership.add(game(id)));
    localStorage.setItem(STEAM_MEMBERS_KEY, JSON.stringify([9101, 9102]));
    const sync = vi.spyOn(digitalProcessManager, "steamSync").mockResolvedValue({ found: true, linked: [], owned: [{ app_id: 9101, name: "G9101" }], removed: [9103], games: [9101] } as never);
    try {
      await syncSteamLibrary();
      const ids = libraryMembership.getGames().map(item => item.app_id);
      expect(ids).toContain(9101);
      expect(ids).not.toContain(9102);   // its account left
      expect(ids).not.toContain(9103);   // the first sync after the update: its Steam record was just removed
      expect(JSON.parse(localStorage.getItem(STEAM_MEMBERS_KEY) || "[]")).toEqual([9101]);
    } finally {
      sync.mockRestore();
      [9101, 9102, 9103].forEach(id => libraryMembership.remove(game(id)));
      localStorage.removeItem(STEAM_MEMBERS_KEY);
      vi.unstubAllGlobals();
    }
  });
});
