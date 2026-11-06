import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useRef } from "react";

import { CATALOG_TABS } from "./CatalogTabs";
import { installKeyboardRules } from "./keyboardRules";
import type { CatalogMode } from "./catalogMode";

type ModeUiState = {
  selectedGameId: number | null;
  gridScrollTop: number;
  detailScrollTop: number;
};

const stateByMode = new Map<CatalogMode, ModeUiState>();

const emptyState = (): ModeUiState => ({ selectedGameId: null, gridScrollTop: 0, detailScrollTop: 0 });
const libraryRoot = () => document.querySelector<HTMLElement>(".library-room:not(.surface-display):not(.surface-tablet)");
const libraryGrid = () => libraryRoot()?.querySelector<HTMLElement>(".library-room-grid") ?? null;
const detailPanel = () => libraryRoot()?.querySelector<HTMLElement>(".library-room-feature") ?? null;
const modal = () => document.querySelector<HTMLElement>('[role="dialog"][aria-modal="true"]');
const cards = () => Array.from(libraryGrid()?.querySelectorAll<HTMLButtonElement>(".library-room-card") ?? []);
const selectedCard = () => libraryGrid()?.querySelector<HTMLButtonElement>(".library-room-card.is-selected") ?? null;
const gameIdOf = (card: HTMLElement | null) => {
  const value = Number(card?.dataset.libraryGameId);
  return Number.isFinite(value) && value > 0 ? value : null;
};

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || target.matches("input, textarea, select, [role='textbox']");
}

function focusModalIfNeeded(): boolean {
  const current = modal();
  if (!current) return false;
  if (current.contains(document.activeElement)) return true;
  const target = current.querySelector<HTMLElement>("[data-dialog-initial], button:not(:disabled), input:not(:disabled), [tabindex]:not([tabindex='-1'])");
  target?.focus({ preventScroll: true });
  return true;
}

/**
 * Put every scrollable container back to the top.
 *
 * Used on launch: the app must open at the top of the grid, not wherever the
 * first card's focus or a restored offset left it. The grid is the scroller, but
 * the room and the window are cleared too, because a stale offset on any of them
 * moves the content the user sees.
 */
function scrollEverythingToTop(): void {
  const grid = libraryGrid();
  if (grid) grid.scrollTop = 0;
  libraryRoot()?.scrollTo({ top: 0, behavior: "auto" });
  if (typeof window !== "undefined" && window.scrollY) window.scrollTo({ top: 0, behavior: "auto" });
}

/**
 * Focus the grid without moving it.
 *
 * `focus()` is called with `preventScroll` and no `scrollIntoView` follows, so
 * focusing the first card cannot drag the view off the top. Keyboard navigation
 * still scrolls: it calls the paging helpers, which do their own scrolling.
 */
function focusGridWithoutScrolling(): void {
  const target = selectedCard() ?? cards()[0];
  if (target) {
    target.focus({ preventScroll: true });
    return;
  }
  libraryRoot()?.focus({ preventScroll: true });
}

function focusGrid(): void {
  const target = selectedCard() ?? cards()[0];
  if (target) {
    target.focus({ preventScroll: true });
    target.scrollIntoView({ block: "nearest", inline: "nearest" });
    return;
  }
  libraryRoot()?.focus({ preventScroll: true });
}

export function nextCatalogMode(current: CatalogMode, backwards = false): CatalogMode {
  const available = CATALOG_TABS.map((tab) => tab.id);
  const currentIndex = Math.max(0, available.indexOf(current));
  const delta = backwards ? -1 : 1;
  return available[(currentIndex + delta + available.length) % available.length] ?? current;
}

export function captureLibraryUiState(mode: CatalogMode): void {
  const previous = stateByMode.get(mode) ?? emptyState();
  stateByMode.set(mode, {
    selectedGameId: gameIdOf(selectedCard()) ?? previous.selectedGameId,
    gridScrollTop: libraryGrid()?.scrollTop ?? previous.gridScrollTop,
    detailScrollTop: detailPanel()?.scrollTop ?? previous.detailScrollTop,
  });
}

/**
 * Restore a mode's remembered position, or open at the top.
 *
 * A mode with no remembered state — which is the case on launch — is placed at the
 * top and focused without scrolling. Previously it called `focusGrid()`, whose
 * `scrollIntoView` could move the grid, so the app opened somewhere in the middle
 * of the catalogue instead of at its first row.
 */
function restoreMode(mode: CatalogMode): void {
  const remembered = stateByMode.get(mode);
  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => {
      if (!remembered) {
        // First entry into this mode: top of the list, focus without moving it.
        scrollEverythingToTop();
        focusGridWithoutScrolling();
        return;
      }
      const allCards = cards();
      const requested = remembered.selectedGameId == null
        ? null
        : allCards.find((card) => gameIdOf(card) === remembered.selectedGameId) ?? null;
      (requested ?? allCards[0])?.focus({ preventScroll: true });
      if (libraryGrid()) libraryGrid()!.scrollTop = remembered.gridScrollTop;
      if (detailPanel()) detailPanel()!.scrollTop = remembered.detailScrollTop;
      focusGrid();
    });
  });
}

function enterDetail(): void {
  selectedCard()?.click();
}

function pageActivePanel(direction: 1 | -1): void {
  const active = document.activeElement as HTMLElement | null;
  const detail = detailPanel();
  const grid = libraryGrid();
  const panel = detail && active && detail.contains(active) ? detail : grid;
  if (!panel) return;
  const amount = Math.max(120, panel.clientHeight * 0.9) * direction;
  panel.scrollBy({ top: amount, behavior: "auto" });
}

function refocusOperationalSurface(): void {
  window.requestAnimationFrame(() => {
    if (focusModalIfNeeded()) return;
    const active = document.activeElement as HTMLElement | null;
    if (active && active !== document.body && active !== document.documentElement) return;
    focusGrid();
  });
}

export const TOGGLE_COLLECTION_EVENT = "gameaccess:toggle-collection";

export default function LibraryInputController({ mode, onModeChange }: { mode: CatalogMode; onModeChange: (mode: CatalogMode) => void }) {
  // Fields take the focus when they show, Enter moves on, the frame's buttons answer to 1–9 (keyboardRules.ts).
  useEffect(() => installKeyboardRules(), []);
  const modeRef = useRef(mode);

  useEffect(() => {
    modeRef.current = mode;
    restoreMode(mode);
  }, [mode]);

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      // A screen (kids, home, settings) hides the grid: its keys are not the grid's (appScreen.ts).
      if (!libraryRoot() || modal() || document.documentElement.classList.contains("ga-screen-on")) return;
      if (event.target instanceof HTMLElement && event.target.closest(".library-section-heading button, .library-section-pages button, .library-catalog-toolbar button, .library-catalog-filter-actions, .ga-big-screen-toggle, .ga-pad-keyboard, [role='scrollbar']")) return;
      const key = event.key.toLowerCase();

      if (key === "tab" && modeRef.current === "digital" && !event.altKey && !event.ctrlKey && !event.metaKey) {
        // Inside a game's detail Tab keeps cycling its own controls.
        if (document.querySelector(".ga-detail-overlay") || isEditable(event.target)) return;
        if (event.repeat) return;
        event.preventDefault();
        event.stopPropagation();
        window.dispatchEvent(new Event(TOGGLE_COLLECTION_EVENT));
        return;
      }

      if (key === "tab" && modeRef.current !== "digital" && !event.altKey && !event.ctrlKey && !event.metaKey) {
        if (event.repeat) return;
        event.preventDefault();
        event.stopPropagation();
        captureLibraryUiState(modeRef.current);
        onModeChange(nextCatalogMode(modeRef.current, event.shiftKey));
        return;
      }

      if (isEditable(event.target)) {
        if (key === "escape" && event.target instanceof HTMLElement && event.target.closest(".global-search")) {
          event.preventDefault();
          event.stopPropagation();
          focusGrid();
        }
        return;
      }

      const active = document.activeElement as HTMLElement | null;
      const inDetail = Boolean(active?.closest(".library-room-feature"));
      if (key === "escape") {
        if (!inDetail) return;
        event.preventDefault();
        event.stopPropagation();
        focusGrid();
        return;
      }
      if (key === "pageup" || key === "pagedown") {
        event.preventDefault();
        event.stopPropagation();
        pageActivePanel(key === "pagedown" ? 1 : -1);
        return;
      }
      if (inDetail) return;
      if (key === "enter") {
        if (event.repeat) return;
        event.preventDefault();
        event.stopPropagation();
        enterDetail();
      }
      // Directional keys deliberately bubble to LibraryRoom. It owns the actual
      // rendered column count, so Up/Down move exactly one visual row.
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [onModeChange]);

  useEffect(() => {
    const onFocus = () => refocusOperationalSurface();
    const onVisibility = () => { if (document.visibilityState === "visible") refocusOperationalSurface(); };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    let disposed = false;
    let nativeUnlisten: (() => void) | null = null;
    if ("__TAURI_INTERNALS__" in window) {
      void getCurrentWindow().onFocusChanged(({ payload: focused }) => {
        if (focused) refocusOperationalSurface();
      }).then((unlisten) => {
        if (disposed) unlisten();
        else nativeUnlisten = unlisten;
      }).catch(() => undefined);
    }
    return () => {
      disposed = true;
      nativeUnlisten?.();
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  // Search UI lives in SteamGlobalSearch inside the existing right-side topbar.
  return null;
}
