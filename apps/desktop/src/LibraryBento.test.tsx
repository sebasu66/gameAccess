// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LibraryGame } from "./catalog/DigitalProcessManager";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;

let entries: LibraryGame[] = [];
vi.mock("./libraryScan", async original => ({ ...(await original<typeof import("./libraryScan")>()), useLibraryScan: () => ({ games: entries, transfers: [], summary: null, usage: null, scanning: false, error: "" }) }));

import LibraryBento from "./LibraryBento";
import { setBigPictureActive } from "./bigPicture";
import type { CatalogGame } from "./types";

const game: CatalogGame = { id: 620, slug: "portal-2", name: "Portal 2", app_id: 620, credit_cost_per_hour: 0, copies_total: 1, copies_available: 1 };
const other: CatalogGame = { id: 400, slug: "portal", name: "Portal", app_id: 400, credit_cost_per_hour: 0, copies_total: 1, copies_available: 1 };
const entry = (extra: Partial<LibraryGame> = {}) => ({ app_id: 620, name: "Portal 2", folder: "Portal 2 (620)", state: "ready", installed: true, standard: true, issues: [], ...extra }) as unknown as LibraryGame;

const downloads = {}, preferences = {};
let root: Root | null = null;
afterEach(() => { if (root) act(() => root?.unmount()); root = null; document.body.innerHTML = ""; setBigPictureActive(false); });

function mount(games = [game]) {
  const container = document.createElement("div");
  container.className = "library-section-scroll";
  // jsdom lays nothing out: a tall scroller, so the sliding window mounts every card.
  Object.defineProperty(container, "clientHeight", { value: 4000 });
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(<LibraryBento games={games} downloads={downloads} preferences={preferences} pill="all" indexes={new Map(games.map((item, index) => [item.id, index]))} onSelect={() => undefined} onContextMenu={() => undefined} />));
  return container;
}

describe("the library's bento card", () => {
  it("shows the alert of a game that did not open here, with why in its tooltip", () => {
    entries = [entry({ run_check: { state: "cantRun", at: "2026-11-02T10:00:00", detail: "no game process appeared in 30 s" } })];
    const alert = mount().querySelector(".ga-bento-alert");
    expect(alert?.getAttribute("title")).toMatch(/(No abrió en esta PC|Did not open on this PC): no game process appeared in 30 s/);
  });

  it("shows no alert for a game that ran fine", () => {
    entries = [entry({ run_check: { state: "checked", at: "2026-11-02T10:00:00", detail: "" } })];
    expect(mount().querySelector(".ga-bento-alert")).toBeNull();
  });

  it("opens its menu on a right click after big picture mode was entered and left", () => {
    entries = [entry()];
    const container = mount();
    act(() => setBigPictureActive(true));
    act(() => setBigPictureActive(false));
    const card = container.querySelector<HTMLElement>(".ga-bento-card");
    expect(card).not.toBeNull();
    act(() => { card!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2 })); });
    expect(document.querySelector(".ga-side-menu")).not.toBeNull();
  });

  it("a right click on another card closes the open menu and opens that card's", () => {
    entries = [entry(), entry({ app_id: 400, name: "Portal", folder: "Portal (400)" })];
    const container = mount([game, other]);
    const rightClick = (id: number) => act(() => { container.querySelector<HTMLElement>(`.ga-bento-card[data-library-game-id="${id}"]`)!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2 })); });
    rightClick(620);
    expect(document.querySelector(".ga-side-menu")?.getAttribute("aria-label")).toContain("Portal 2");
    rightClick(400);
    const menus = document.querySelectorAll(".ga-side-menu");
    expect(menus).toHaveLength(1);
    expect(menus[0].getAttribute("aria-label")).not.toContain("Portal 2");
    expect(menus[0].getAttribute("aria-label")).toContain("Portal");
  });
});
