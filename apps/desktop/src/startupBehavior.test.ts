/**
 * Two behaviours that are decisions rather than algorithms, pinned so they do not
 * drift back.
 *
 * Both are asserted against the source because what matters is the wiring: the
 * hero mode is a constant consulted at two call sites, and the launch scroll is a
 * sequence of DOM writes whose ordering is the point. A behavioural test would
 * need a rendered catalogue and a real scroller to say the same thing.
 */
import { describe, expect, it } from "vitest";
import appSource from "./App.tsx?raw";
import controllerSource from "./LibraryInputController.tsx?raw";
import { HERO_AUTOPLAY } from "./featureModes";

describe("the featured-game hero does not run by itself", () => {
  it("is switched off", () => {
    // Turned off because rotating the featured game every 18 seconds moves the
    // page under the reader. Set HERO_AUTOPLAY to true to bring it back.
    expect(HERO_AUTOPLAY).toBe(false);
  });

  it("keeps the rotation and the autoplay behind the flag", () => {
    // Both automatic behaviours consult the flag, so flipping it restores the
    // whole mode and nothing is left half-on.
    expect(appSource).toContain("!HERO_AUTOPLAY || heroPaused || heroPool.length < 2");
    expect(appSource).toContain("autoPlay={HERO_AUTOPLAY && !heroPaused}");
    // The mode is off, not deleted: the rotation itself is still there.
    expect(appSource).toContain("setHeroIndex((current) => (current + 1) % heroPool.length), 18000");
  });

  it("still shows one featured game statically", () => {
    // The hero, its artwork and its controls remain: only the movement stops.
    expect(appSource).toContain("const featured = magazineGames[magazineFocus] || heroPool[heroIndex]");
    expect(appSource).toContain('className="hero hero-video magazine-feature"');
  });
});

describe("the app opens at the top of the catalogue", () => {
  it("resets the grid, the room and the window", () => {
    // Any of the three left with a stale offset moves what the user sees, so all
    // of them are cleared.
    expect(controllerSource).toContain("function scrollEverythingToTop()");
    expect(controllerSource).toContain("if (grid) grid.scrollTop = 0");
    expect(controllerSource).toContain('libraryRoot()?.scrollTo({ top: 0, behavior: "auto" })');
  });

  it("focuses the first card without scrolling to it", () => {
    // The bug: focusGrid() called scrollIntoView, which could drag the view down
    // to the selected card on launch.
    expect(controllerSource).toContain("function focusGridWithoutScrolling()");
    expect(controllerSource).toContain("scrollEverythingToTop();");
    expect(controllerSource).toContain("focusGridWithoutScrolling();");
  });

  it("opens at the top only when the mode has no remembered position", () => {
    // Switching tabs still restores where the user was; only a first entry resets.
    expect(controllerSource).toContain("const remembered = stateByMode.get(mode);");
    expect(controllerSource).toContain("if (!remembered) {");
    expect(controllerSource).toContain("libraryGrid()!.scrollTop = remembered.gridScrollTop");
  });

  it("keeps keyboard paging able to scroll, unlike the launch focus", () => {
    // focusGrid still scrolls, because the paging helpers rely on it.
    expect(controllerSource).toContain('target.scrollIntoView({ block: "nearest", inline: "nearest" })');
  });
});
