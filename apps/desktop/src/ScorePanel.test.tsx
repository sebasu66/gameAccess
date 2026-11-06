// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ScorePanel } from "./SentencePanels";
import { DEFAULT_LIBRARY_FILTERS, MIN_REVIEWS_OPTION, type LibrarySearchFilters } from "./librarySearch";

// React only flushes act() work when it knows it is in a test environment.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// The slider needs layout that jsdom does not have; this panel test is about the checkbox under it.
vi.mock("./FancySlider", () => ({ default: () => <div data-testid="slider" /> }));

let root: Root | null = null;
let host: HTMLElement | null = null;

function mount(filters: LibrarySearchFilters, onChange: (patch: Partial<LibrarySearchFilters>) => void) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => { root!.render(<ScorePanel filters={filters} onChange={onChange} />); });
  return host;
}

afterEach(() => {
  act(() => { root?.unmount(); });
  host?.remove();
  root = null;
  host = null;
});

describe("ScorePanel minimum reviews checkbox", () => {
  it("sits under the slider, unchecked by default, and names the review count", () => {
    const view = mount({ ...DEFAULT_LIBRARY_FILTERS }, () => undefined);
    const children = [...view.querySelector(".ga-sx-slider")!.children];
    const slider = children.findIndex(el => el.getAttribute("data-testid") === "slider");
    const check = children.findIndex(el => el.classList.contains("ga-sx-check"));
    expect(slider).toBeGreaterThanOrEqual(0);
    expect(check).toBeGreaterThan(slider);

    const input = view.querySelector<HTMLInputElement>(".ga-sx-check input[type=checkbox]")!;
    expect(input.checked).toBe(false);
    expect(view.querySelector(".ga-sx-check")!.textContent).toContain(String(MIN_REVIEWS_OPTION));
    expect(view.querySelector(".ga-sx-check")!.classList.contains("is-on")).toBe(false);
  });

  it("checking it asks for 100 reviews, and unchecking clears the bar", () => {
    const onChange = vi.fn();
    const view = mount({ ...DEFAULT_LIBRARY_FILTERS }, onChange);
    act(() => { view.querySelector<HTMLInputElement>(".ga-sx-check input")!.click(); });
    expect(onChange).toHaveBeenLastCalledWith({ minReviewCount: 100 });

    act(() => { root!.render(<ScorePanel filters={{ ...DEFAULT_LIBRARY_FILTERS, minReviewCount: 100 }} onChange={onChange} />); });
    const input = view.querySelector<HTMLInputElement>(".ga-sx-check input")!;
    expect(input.checked).toBe(true);
    expect(view.querySelector(".ga-sx-check")!.classList.contains("is-on")).toBe(true);

    act(() => { input.click(); });
    expect(onChange).toHaveBeenLastCalledWith({ minReviewCount: undefined });
  });
});
