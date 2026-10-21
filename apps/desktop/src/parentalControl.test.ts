/**
 * Parental control: the enforced policy must win over any discovery selection.
 *
 * The property that matters is that a positive tag filter cannot reveal content
 * the policy blocks. If it could, the control would be cosmetic: marking
 * "Hentai" in Descubrir would be a one-click bypass.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyParentalPolicy,
  blockedDescriptorIds,
  getParentalPolicy,
  isParentalLocked,
  parentalSearchFilters,
  reloadParentalPolicyForTests,
  resetParentalPolicyForTests,
  saveParentalPolicy,
  setParentalPolicyForTests,
  subscribeParentalPolicy,
} from "./parentalControl";
import { DEFAULT_LIBRARY_FILTERS, filterLibraryGames, gameIsAdult } from "./librarySearch";
import type { CatalogGame } from "./types";

function game(overrides: Partial<CatalogGame>): CatalogGame {
  return {
    id: 1, slug: "g", name: "Game", app_id: 1,
    credit_cost_per_month: 0, credit_cost_per_hour: 0, copies_total: 1, copies_available: 1,
    ...overrides,
  } as CatalogGame;
}

describe("parental policy storage", () => {
  beforeEach(() => resetParentalPolicyForTests());
  afterEach(() => {
    resetParentalPolicyForTests();
    vi.unstubAllGlobals();
  });

  it("starts on, hiding adult-only content, until someone turns it off", () => {
    expect(isParentalLocked()).toBe(true);
    expect(getParentalPolicy()).toEqual({ enabled: true, level: "adult-only", hideViolence: false });
    expect(blockedDescriptorIds()).toEqual([3, 4]);
  });

  it("outside the app the choice is kept in the browser and survives a reload", async () => {
    const stored = new Map<string, string>();
    vi.stubGlobal("localStorage", { getItem: (k: string) => stored.get(k) ?? null, setItem: (k: string, v: string) => void stored.set(k, v), removeItem: (k: string) => void stored.delete(k) });
    await saveParentalPolicy({ level: "off" });
    expect(isParentalLocked()).toBe(false);
    reloadParentalPolicyForTests();
    expect(getParentalPolicy().level).toBe("off");
  });

  it("treats level off as unlocked even when enabled is set", () => {
    setParentalPolicyForTests({ enabled: true, level: "off" });
    expect(isParentalLocked()).toBe(false);
    expect(blockedDescriptorIds()).toEqual([]);
  });

  it("blocks descriptor 3 and 4 at the adult-only level", () => {
    setParentalPolicyForTests({ enabled: true, level: "adult-only" });
    expect(isParentalLocked()).toBe(true);
    expect(blockedDescriptorIds()).toEqual([3, 4]);
    expect(parentalSearchFilters()).toEqual({ hideAdult: true, adultIncludesNudity: false, hideViolenceDescriptor: false });
  });

  it("also blocks descriptor 1 at the strict level", () => {
    setParentalPolicyForTests({ enabled: true, level: "strict" });
    expect(blockedDescriptorIds()).toEqual([3, 4, 1]);
    expect(parentalSearchFilters().adultIncludesNudity).toBe(true);
  });

  it("adds the violence descriptor only when asked", () => {
    setParentalPolicyForTests({ enabled: true, level: "adult-only", hideViolence: true });
    expect(blockedDescriptorIds()).toEqual([3, 4, 2]);
    expect(parentalSearchFilters().hideViolenceDescriptor).toBe(true);
  });

  it("notifies subscribers on change", () => {
    const seen = vi.fn();
    const unsubscribe = subscribeParentalPolicy(seen);
    setParentalPolicyForTests({ enabled: true, level: "strict" });
    expect(seen).toHaveBeenCalledTimes(1);
    unsubscribe();
    setParentalPolicyForTests({ enabled: false });
    expect(seen).toHaveBeenCalledTimes(1);
  });
});

describe("the policy cannot be bypassed from the discovery filters", () => {
  beforeEach(() => resetParentalPolicyForTests());
  afterEach(() => resetParentalPolicyForTests());

  const adultOnly = game({ id: 1, name: "Explicit", content_descriptorids: [1, 3, 4, 5], tags: ["Hentai"] });
  const southPark = game({ id: 2, name: "South Park", content_descriptorids: [1, 2, 5], tags: ["Nudity"] });
  const mk11 = game({ id: 3, name: "Mortal Kombat 11", content_descriptorids: [2, 5], tags: ["Sexual Content"] });
  const family = game({ id: 4, name: "Stardew", tags: [] });
  const games = [adultOnly, southPark, mk11, family];

  it("blocks adult-only content even when the descriptor filter asks for it", () => {
    // Unlocked, requesting the descriptors is a legitimate way to look for this
    // content. Tags cannot express it any more: they do not filter.
    const selected = { ...DEFAULT_LIBRARY_FILTERS, contentDescriptorIds: [1, 3, 4] };
    expect(filterLibraryGames(games, "", selected).map(g => g.id)).toEqual([1, 2]);

    // Under a lock the same request must not reveal it. This is the bypass the
    // policy merge exists to prevent.
    setParentalPolicyForTests({ enabled: true, level: "adult-only" });
    const locked = applyParentalPolicy(selected);
    expect(filterLibraryGames(games, "", locked).map(g => g.id)).not.toContain(1);
  });

  it("leaves mainstream titles alone, which is the false positive we removed", () => {
    setParentalPolicyForTests({ enabled: true, level: "adult-only" });
    // MK11 is tagged "Sexual Content" but Valve lists no sexual descriptor for it,
    // so the adult-only level must not hide it. The old implementation consulted
    // tags and hid it, which is the false positive this test pins down.
    const locked = applyParentalPolicy(DEFAULT_LIBRARY_FILTERS);
    expect(filterLibraryGames([mk11], "", locked).map(g => g.id)).toEqual([3]);
    expect(filterLibraryGames([adultOnly], "", locked)).toHaveLength(0);
    expect(gameIsAdult(mk11)).toBe(false);
  });

  it("hides descriptor 1 only at the strict level", () => {
    const adultOnlyLevel = applyParentalPolicy(DEFAULT_LIBRARY_FILTERS, setParentalPolicyForTests({ enabled: true, level: "adult-only" }));
    expect(filterLibraryGames([southPark], "", adultOnlyLevel)).toHaveLength(1);

    const strictLevel = applyParentalPolicy(DEFAULT_LIBRARY_FILTERS, setParentalPolicyForTests({ enabled: true, level: "strict" }));
    expect(filterLibraryGames([southPark], "", strictLevel)).toHaveLength(0);
  });

  it("hides violence only when the operator opts in", () => {
    const off = applyParentalPolicy(DEFAULT_LIBRARY_FILTERS, setParentalPolicyForTests({ enabled: true, level: "adult-only" }));
    expect(filterLibraryGames([mk11], "", off)).toHaveLength(1);

    const on = applyParentalPolicy(DEFAULT_LIBRARY_FILTERS, setParentalPolicyForTests({ enabled: true, level: "adult-only", hideViolence: true }));
    expect(filterLibraryGames([mk11], "", on)).toHaveLength(0);
  });

  it("changes nothing while unlocked", () => {
    setParentalPolicyForTests({ level: "off" });
    const requested = { ...DEFAULT_LIBRARY_FILTERS, contentDescriptorIds: [1, 3, 4] };
    expect(applyParentalPolicy(requested)).toEqual(requested);
    expect(filterLibraryGames(games, "", applyParentalPolicy(requested)).map(g => g.id)).toEqual([1, 2]);
  });
});
