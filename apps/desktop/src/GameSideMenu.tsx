import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { gsap, motionOk } from "./motion/gsap";

export interface SideMenuItem {
  key: string;
  label: string;
  icon: ReactNode;
  run: () => void;
  /** The main action (orange). */
  primary?: boolean;
  disabled?: boolean;
  title?: string;
}

// The menu closes this long after the pointer leaves its area (Seba, 2026-11-02: a second and a half).
const LEAVE_MS = 1500;
// The area reaches this share of the card's height above and below it (a 100 px card: 10 px each way, 120 px in all).
const LEAVE_MARGIN = 0.1;

type Box = { left: number; top: number; right: number; bottom: number };
/** Where the pointer keeps the menu open: the card and the menu beside it as one box, a little taller than the card
 *  (and the menu, if it is taller). Nothing is added sideways: leaving the card or the menu's outer edge counts. */
export function menuHoldArea(card: Box, menu: Box | null): Box {
  const margin = (card.bottom - card.top) * LEAVE_MARGIN;
  const top = Math.min(card.top, menu?.top ?? card.top), bottom = Math.max(card.bottom, menu?.bottom ?? card.bottom);
  return { left: Math.min(card.left, menu?.left ?? card.left), right: Math.max(card.right, menu?.right ?? card.right), top: top - margin, bottom: bottom + margin };
}

/**
 * The short menu of a game card, in the library and in the catalog (docs/TAREA-interfaz-nueva.md T8): a glass panel
 * that opens beside the card, like an augmented-reality label. Its edge against the card is solid and the glass fades
 * away toward the other sides. It closes when the pointer leaves the card and the menu (menuHoldArea), with Escape or on
 * scroll; a right click on another card replaces it at once. Only the actions that can run are listed: nothing greyed out.
 */
export default function GameSideMenu({ anchor, label, items, note, onClose }: { anchor: HTMLElement; label: string; items: SideMenuItem[]; /** One short line under the actions (the Steam account a game belongs to). */ note?: string; onClose: () => void }) {
  const menu = useRef<HTMLDivElement>(null);
  const timer = useRef(0);
  const closing = useRef(false);
  const [side, setSide] = useState<"right" | "left">("right");
  const close = useCallback(() => {
    if (closing.current) return;
    closing.current = true;
    window.clearTimeout(timer.current);
    if (!menu.current || !motionOk()) { onClose(); return; }
    gsap.to(menu.current, { opacity: 0, x: menu.current.dataset.side === "left" ? 10 : -10, duration: .2, ease: "power2.in", onComplete: onClose });
  }, [onClose]);

  useLayoutEffect(() => {
    const host = menu.current;
    if (!host) return;
    const rect = anchor.getBoundingClientRect();
    const width = host.offsetWidth, height = host.offsetHeight;
    // Beside the card, toward the side with more room; vertically centred on the card and kept inside the window.
    const right = rect.right + width <= window.innerWidth - 8 || rect.left < width;
    const left = right ? rect.right - 6 : rect.left - width + 6;
    const top = Math.min(Math.max(8, rect.top + rect.height / 2 - height / 2), window.innerHeight - 60 - height);
    setSide(right ? "right" : "left");
    host.dataset.side = right ? "right" : "left";
    gsap.set(host, { left, top });
    const buttons = host.querySelectorAll(".ga-side-menu-items button");
    const focusFirst = () => (host.querySelector(".ga-side-menu-items button:not(:disabled)") as HTMLButtonElement | null)?.focus({ preventScroll: true });
    if (!motionOk()) { focusFirst(); return; }
    const tl = gsap.timeline({ onComplete: focusFirst })
      .fromTo(host, { opacity: 0, x: right ? -14 : 14 }, { opacity: 1, x: 0, duration: .35, ease: "power3.out" })
      .fromTo(buttons, { opacity: 0, x: right ? -8 : 8 }, { opacity: 1, x: 0, duration: .3, stagger: .05, ease: "power3.out" }, "<.08");
    return () => { tl.kill(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    // Closing depends on where the pointer is, not on which element it crosses: moving between the card, the menu and
    // its buttons never counts as leaving.
    const inside = (event: PointerEvent) => {
      // The menu counts by its buttons, not by its glass, which is much bigger and fades away over the next cards.
      const area = menuHoldArea(anchor.getBoundingClientRect(), menu.current?.querySelector(".ga-side-menu-items")?.getBoundingClientRect() ?? null);
      return event.clientX >= area.left && event.clientX <= area.right && event.clientY >= area.top && event.clientY <= area.bottom;
    };
    const move = (event: PointerEvent) => {
      if (inside(event)) { window.clearTimeout(timer.current); timer.current = 0; }
      else if (!timer.current) timer.current = window.setTimeout(() => { timer.current = 0; close(); }, LEAVE_MS);
    };
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") { event.stopPropagation(); close(); } };
    const scroll = () => close();
    window.addEventListener("pointermove", move);
    window.addEventListener("keydown", key, true);
    window.addEventListener("scroll", scroll, true);
    return () => { window.clearTimeout(timer.current); timer.current = 0; window.removeEventListener("pointermove", move); window.removeEventListener("keydown", key, true); window.removeEventListener("scroll", scroll, true); };
  }, [anchor, close]);

  return createPortal(
    <div ref={menu} className="ga-side-menu" data-side={side} role="menu" aria-label={label} onContextMenu={event => {
      // The menu lies over the next card: a right click on it is meant for the card under it, which opens its own menu.
      event.preventDefault();
      const card = document.elementsFromPoint(event.clientX, event.clientY).find(element => !menu.current?.contains(element) && !anchor.contains(element) && element.closest("[data-library-game-id]"));
      if (card) card.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2, clientX: event.clientX, clientY: event.clientY }));
      else close();
    }}>
      <span className="ga-side-menu-glass" aria-hidden="true" />
      <div className="ga-side-menu-items">
        {items.map(item => <button key={item.key} type="button" role="menuitem" className={item.primary ? "primary" : undefined} disabled={item.disabled} title={item.title} onClick={() => { close(); item.run(); }}>{item.icon}{item.label}</button>)}
        {note ? <p className="ga-side-menu-note">{note}</p> : null}
      </div>
    </div>,
    document.body,
  );
}
