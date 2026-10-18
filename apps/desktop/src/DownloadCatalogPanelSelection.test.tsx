// @vitest-environment jsdom
import { act, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import DownloadCatalogPanel from "./DownloadCatalogPanel";
import type { CatalogGame } from "./types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;

const game = (id: number): CatalogGame => ({ id, slug: `game-${id}`, name: `Game ${id}`, app_id: id + 1000, credit_cost_per_hour: 0, copies_total: 1, copies_available: 1 });

let root: Root | null = null;
afterEach(() => { if (root) act(() => root?.unmount()); root = null; document.body.innerHTML = ""; });

describe("DownloadCatalogPanel card selection", () => {
  it("selects the clicked game after a new search returns as many results with the same first game", () => {
    // The catalog query is capped at 1000 rows, so two different searches often return the same count;
    // a popular first game is often in both. The card must still report its index in the new results.
    const first = [game(1), game(2), game(3)];
    const second = [game(1), game(7), game(8)];
    const onSelect = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    const render = (games: CatalogGame[]) => act(() => root!.render(
      <DownloadCatalogPanel games={games} downloads={{}} selectedIndex={0} gridRef={createRef<HTMLDivElement>()} pinnedAppIds={new Set()} onSelect={onSelect} />,
    ));
    render(first);
    render(second);
    const card = container.querySelector<HTMLElement>('[data-library-game-id="8"]');
    expect(card).not.toBeNull();
    onSelect.mockClear();
    act(() => card!.click());
    expect(onSelect).toHaveBeenLastCalledWith(2);
  });
});
