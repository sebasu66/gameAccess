import { getCurrentWindow } from "@tauri-apps/api/window";
import { Search } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { CATALOG_TABS } from "./CatalogTabs";
import type { CatalogMode } from "./catalogMode";
import { LIBRARY_SEARCH_EVENT } from "./librarySearch";

type Direction = "left" | "right" | "up" | "down";
type ModeUiState = {
  selectedGameId: number | null;
  query: string;
  gridScrollTop: number;
  detailScrollTop: number;
};

const stateByMode = new Map<CatalogMode, ModeUiState>();

const emptyState = (): ModeUiState => ({ selectedGameId: null, query: "", gridScrollTop: 0, detailScrollTop: 0 });
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

function focusGrid(): void {
  const target = selectedCard() ?? cards()[0];
  if (target) {
    target.focus({ preventScroll: true });
    target.scrollIntoView({ block: "nearest", inline: "nearest" });
    return;
  }
  libraryRoot()?.focus({ preventScroll: true });
}

function gridColumnCount(items: HTMLElement[]): number {
  if (items.length < 2) return 1;
  const firstTop = items[0].offsetTop;
  const count = items.findIndex((item, index) => index > 0 && Math.abs(item.offsetTop - firstTop) > 1);
  return count > 0 ? count : Math.max(1, Math.round(Math.sqrt(items.length)));
}

export function nextGridIndex(index: number, count: number, columns: number, direction: Direction): number {
  if (count <= 0) return -1;
  const safe = Math.max(0, Math.min(count - 1, index));
  const cols = Math.max(1, columns);
  if (direction === "left") return safe % cols === 0 ? safe : safe - 1;
  if (direction === "right") return safe % cols === cols - 1 || safe === count - 1 ? safe : safe + 1;
  if (direction === "up") return Math.max(0, safe - cols);
  return Math.min(count - 1, safe + cols);
}

export function nextCatalogMode(current: CatalogMode, backwards = false): CatalogMode {
  const available = CATALOG_TABS.map((tab) => tab.id);
  const currentIndex = Math.max(0, available.indexOf(current));
  const delta = backwards ? -1 : 1;
  return available[(currentIndex + delta + available.length) % available.length] ?? current;
}

export function captureLibraryUiState(mode: CatalogMode): void {
  const previous = stateByMode.get(mode) ?? emptyState();
  const query = document.querySelector<HTMLInputElement>(".library-global-search input")?.value ?? previous.query;
  stateByMode.set(mode, {
    selectedGameId: gameIdOf(selectedCard()) ?? previous.selectedGameId,
    query,
    gridScrollTop: libraryGrid()?.scrollTop ?? previous.gridScrollTop,
    detailScrollTop: detailPanel()?.scrollTop ?? previous.detailScrollTop,
  });
}

function dispatchQuery(query: string): void {
  window.dispatchEvent(new CustomEvent(LIBRARY_SEARCH_EVENT, { detail: { query } }));
}

function restoreMode(mode: CatalogMode, setQuery: (value: string) => void): void {
  const state = stateByMode.get(mode) ?? emptyState();
  setQuery(state.query);
  dispatchQuery(state.query);
  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => {
      const allCards = cards();
      const requested = state.selectedGameId == null
        ? null
        : allCards.find((card) => gameIdOf(card) === state.selectedGameId) ?? null;
      (requested ?? allCards[0])?.click();
      if (libraryGrid()) libraryGrid()!.scrollTop = state.gridScrollTop;
      if (detailPanel()) detailPanel()!.scrollTop = state.detailScrollTop;
      focusGrid();
    });
  });
}

function moveSelection(direction: Direction): void {
  const items = cards();
  if (!items.length) return;
  const selected = selectedCard();
  const index = Math.max(0, selected ? items.indexOf(selected) : 0);
  const next = nextGridIndex(index, items.length, gridColumnCount(items), direction);
  const target = items[next];
  if (!target || target === selected) return;
  target.click();
  target.focus({ preventScroll: true });
  target.scrollIntoView({ block: "nearest", inline: "nearest" });
}

function enterDetail(): void {
  const action = libraryRoot()?.querySelector<HTMLButtonElement>(".glass-action:not(:disabled)");
  action?.focus({ preventScroll: true });
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

export default function LibraryInputController({ mode, onModeChange }: { mode: CatalogMode; onModeChange: (mode: CatalogMode) => void }) {
  const [query, setQuery] = useState(() => stateByMode.get(mode)?.query ?? "");
  const modeRef = useRef(mode);

  useEffect(() => {
    modeRef.current = mode;
    restoreMode(mode, setQuery);
  }, [mode]);

  const changeQuery = useCallback((value: string) => {
    setQuery(value);
    const state = stateByMode.get(modeRef.current) ?? emptyState();
    stateByMode.set(modeRef.current, { ...state, query: value });
    dispatchQuery(value);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (!libraryRoot()) return;
      const currentModal = modal();
      if (currentModal) return;
      const key = event.key.toLowerCase();
      const editable = isEditable(event.target);

      if ((event.ctrlKey || event.metaKey) && !event.altKey && key === "f") {
        event.preventDefault();
        event.stopPropagation();
        document.querySelector<HTMLInputElement>(".library-global-search input")?.focus({ preventScroll: true });
        return;
      }
      if (event.altKey || event.metaKey || (event.ctrlKey && key !== "f")) return;

      if (key === "tab") {
        if (event.repeat) return;
        event.preventDefault();
        event.stopPropagation();
        captureLibraryUiState(modeRef.current);
        onModeChange(nextCatalogMode(modeRef.current, event.shiftKey));
        return;
      }

      if (editable) {
        if (key === "escape" && event.target instanceof HTMLElement && event.target.closest(".library-global-search")) {
          event.preventDefault();
          event.stopPropagation();
          focusGrid();
        }
        return;
      }

      const active = document.activeElement as HTMLElement | null;
      const inDetail = Boolean(active?.closest(".library-room-feature"));
      if (key === "escape") {
        event.preventDefault();
        event.stopPropagation();
        if (inDetail) {
          focusGrid();
        } else if (query) {
          changeQuery("");
          window.requestAnimationFrame(focusGrid);
        }
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
        return;
      }
      const direction: Direction | null = key === "arrowleft" || key === "a" ? "left"
        : key === "arrowright" || key === "d" ? "right"
          : key === "arrowup" || key === "w" ? "up"
            : key === "arrowdown" || key === "s" ? "down" : null;
      if (direction) {
        event.preventDefault();
        event.stopPropagation();
        moveSelection(direction);
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [changeQuery, onModeChange, query]);

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

  return (
    <label className="library-global-search" aria-label="Buscar en la biblioteca">
      <Search size={15} aria-hidden="true" />
      <input
        value={query}
        onChange={(event) => changeQuery(event.currentTarget.value)}
        placeholder="Buscar juegos · Ctrl+F"
        autoComplete="off"
        spellCheck={false}
      />
    </label>
  );
}
