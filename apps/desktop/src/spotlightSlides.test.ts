// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invoke(...args) }));

import { featuredAppIds, inFeaturedOrder } from "./spotlightSlides";
import type { CatalogGame } from "./types";

const game = (app_id: number) => ({ id: app_id, app_id, name: String(app_id) }) as CatalogGame;

describe("catalog banner: Steam featured games", () => {
  beforeEach(() => {
    localStorage.clear();
    invoke.mockReset();
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
  });
  afterEach(() => { delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__; });

  it("keeps the order Steam features them, and only the games of the catalog", () => {
    expect(inFeaturedOrder([30, 99, 10, 20], [game(10), game(20), game(30), game(40)]).map(item => item.app_id)).toEqual([30, 10, 20]);
  });

  it("uses what Steam features now and remembers it", async () => {
    invoke.mockResolvedValue([5, 6]);
    expect(await featuredAppIds()).toEqual([5, 6]);
    expect(invoke).toHaveBeenCalledWith("steam_featured_app_ids");
    invoke.mockRejectedValue(new Error("offline"));
    expect(await featuredAppIds()).toEqual([5, 6]);
  });

  it("has no list offline before Steam ever answered (the banner then shows the new games)", async () => {
    invoke.mockRejectedValue(new Error("offline"));
    expect(await featuredAppIds()).toEqual([]);
  });
});
