import { afterEach, beforeEach, expect, it, vi } from "vitest";
const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
beforeEach(() => { vi.resetModules(); invoke.mockReset(); vi.stubGlobal("window", { __TAURI_INTERNALS__: {} }); vi.stubGlobal("localStorage", { getItem: () => null, setItem: vi.fn() }); });
afterEach(() => vi.unstubAllGlobals());
it("deduplicates concurrent requests but allows recovery after a failed lookup", async () => {
  const { resolveLibraryCover } = await import("./libraryCoverResolver");
  invoke.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce("https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/42/hash/library_capsule.jpg");
  const first = resolveLibraryCover(42);
  expect(resolveLibraryCover(42)).toBe(first);
  expect(await first).toBeNull();
  expect(await resolveLibraryCover(42)).toContain("library_capsule.jpg");
  expect(invoke).toHaveBeenCalledTimes(2);
});
