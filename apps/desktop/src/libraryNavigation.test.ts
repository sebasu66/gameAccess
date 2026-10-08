import { describe, expect, it, vi } from "vitest";
import {
  calculateSelectionScrollTop,
  selectionItemTopInScrollContainer,
  renderedGridColumns,
  tweenSelectionScroll,
} from "./libraryNavigation";

describe("library selection scrolling", () => {
  it("animates toward the target and cancels a superseded tween", () => {
    let callback: FrameRequestCallback = () => {};
    const cancel = vi.fn();
    vi.stubGlobal("requestAnimationFrame", vi.fn(fn => { callback=fn; return 42; }));
    vi.stubGlobal("cancelAnimationFrame",cancel);
    vi.stubGlobal("window",{matchMedia:()=>({matches:false})});
    const clock=vi.spyOn(performance,"now").mockReturnValue(0);
    const root={scrollTop:0} as HTMLElement;
    const stop=tweenSelectionScroll(root,400);
    callback(110);
    expect(root.scrollTop).toBeGreaterThan(0);
    expect(root.scrollTop).toBeLessThan(400);
    stop(); expect(cancel).toHaveBeenCalledWith(42);
    callback(500); expect(root.scrollTop).toBe(400);
    clock.mockRestore();vi.unstubAllGlobals();
  });
  it("counts actual columns without treating centered free space as cards", () => {
    expect(renderedGridColumns("180px 180px 180px 180px 180px 180px 180px 180px 180px")).toBe(9);
    expect(renderedGridColumns("240.5px 240.5px 240.5px")).toBe(3);
    expect(renderedGridColumns("none")).toBe(1);
  });
  it("keeps a visible selection still", () => {
    expect(calculateSelectionScrollTop({ scrollTop: 100, viewportHeight: 400, itemTop: 180, itemHeight: 120 })).toBe(100);
  });

  it("scrolls down when keyboard selection leaves the viewport", () => {
    expect(calculateSelectionScrollTop({ scrollTop: 0, viewportHeight: 400, itemTop: 430, itemHeight: 120, padding: 8 })).toBe(158);
  });

  it("scrolls up when keyboard selection moves above the viewport", () => {
    expect(calculateSelectionScrollTop({ scrollTop: 500, viewportHeight: 400, itemTop: 420, itemHeight: 120, padding: 8 })).toBe(412);
  });

  it("converts viewport rect coordinates into scroll-container coordinates", () => {
    expect(selectionItemTopInScrollContainer({
      scrollTop: 240,
      viewportTop: 100,
      itemTop: 520,
    })).toBe(660);
  });
});
