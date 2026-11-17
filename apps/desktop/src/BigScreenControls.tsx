import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Gamepad2, Keyboard, Maximize, Minimize, Move } from "lucide-react";
import { GamepadInput, type PadAction } from "./gamepadInput";
import { InputSourceArbiter } from "./inputSource";
import { useI18n } from "./i18n";
import { GaIconButton } from "./components/ga/Buttons";
import "./big-picture.css";
import { labelIn } from "./motion/bigPictureMotion";
import { gsap, motionOk } from "./motion/gsap";
import BigPictureIntro, { MenuKey } from "./BigPictureIntro";
import BigPictureRail from "./BigPictureRail";
import BigPictureSearch from "./BigPictureSearch";
import BigExitConfirm from "./BigExitConfirm";
import { bigPictureView, cycleBigPictureOrder, setBigPictureInput, setBigPictureQuery, useBigPictureView } from "./bigPicture";

/**
 * Big picture mode's controls (bigPicture.ts): the footer button, the side rail (search, order, leave), the controller,
 * the keyboard and the legend at the bottom centre. The controller or the keyboard move between the ready-to-play
 * cards (the grid scrolls to keep the chosen one in view), A, Enter or a click ask to play it, X or Ctrl+F search,
 * Y, LB and RB change the order, and Menu, Esc or F11 ask before leaving. No detail, panels or card menus open.
 */
type Props = { footerTarget?: HTMLDivElement | null; enabled: boolean; onToggle: () => void; onDirection: () => void; onAccept: (gameId: number) => void };
type Direction = "left" | "right" | "up" | "down";

const CARDS = ".ga-bento-card";
const RAIL = ".ga-big-rail button";
const DIALOG = '.ga-smoke[role="dialog"]';
const SEARCH = ".ga-big-search";
const ARROWS: Record<string, Direction> = { ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down" };
const visibleCards = (selector = CARDS) => Array.from(document.querySelectorAll<HTMLElement>(selector)).filter(node => node.getClientRects().length > 0);

/** The element that scrolls `node` vertically (the library's grid), or null. */
function scrollHost(node: Element | null): HTMLElement | null {
  for (let el = node?.parentElement ?? null; el; el = el.parentElement) {
    const overflow = getComputedStyle(el).overflowY;
    if ((overflow === "auto" || overflow === "scroll") && el.scrollHeight > el.clientHeight) return el;
  }
  return null;
}
const gridHost = () => scrollHost(document.querySelector(CARDS)) ?? document.querySelector<HTMLElement>(".library-section-scroll");

/**
 * Scrolls the grid so `node` is in view: nothing when it already is (with a margin), otherwise centred in the grid.
 * scrollIntoView did not move the grid in big picture (Seba, 2026-11-10: only the wheel scrolled), so it is done here.
 */
export function revealCard(node: HTMLElement, smooth = true): void {
  const host = scrollHost(node);
  if (!host) { node.scrollIntoView({ block: "nearest" }); return; }
  const box = host.getBoundingClientRect(), rect = node.getBoundingClientRect();
  const margin = Math.min(48, box.height / 10);
  if (rect.top >= box.top + margin && rect.bottom <= box.bottom - margin) return;
  const top = Math.max(0, Math.min(host.scrollHeight - host.clientHeight, host.scrollTop + rect.top - box.top - Math.max(margin, (box.height - rect.height) / 2)));
  // A GSAP tween, not the browser's smooth scroll: that one was cancelled by the grid's own re-render after the focus.
  gsap.killTweensOf(host, "scrollTop");
  if (smooth && motionOk()) gsap.to(host, { scrollTop: top, duration: .35, ease: "power2.out" });
  else host.scrollTop = top;
}

/** The nearest card in that direction from the focused one (or the first card when none is focused). True when the focus moved. */
export function focusCard(direction: Direction, selector = CARDS): boolean {
  const nodes = visibleCards(selector);
  const active = document.activeElement as HTMLElement | null;
  if (!active || !nodes.includes(active)) {
    if (!nodes[0]) return false;
    nodes[0].focus({ preventScroll: true }); revealCard(nodes[0], false); return true;
  }
  const rect = active.getBoundingClientRect(), x = rect.left + rect.width / 2, y = rect.top + rect.height / 2;
  const next = nodes.filter(node => node !== active).map(node => {
    const r = node.getBoundingClientRect(), dx = r.left + r.width / 2 - x, dy = r.top + r.height / 2 - y;
    const along = direction === "right" ? dx : direction === "left" ? -dx : direction === "down" ? dy : -dy;
    const across = direction === "left" || direction === "right" ? Math.abs(dy) : Math.abs(dx);
    return { node, along, score: along + across * 3 };
  }).filter(item => item.along > 2).sort((a, b) => a.score - b.score)[0]?.node;
  if (!next) return false;
  next.focus({ preventScroll: true });
  revealCard(next);
  return true;
}

/** Back to the games: the selected card, or the first one. */
function focusGames(): void {
  const card = document.querySelector<HTMLElement>(`${CARDS}[aria-current="true"]`) ?? visibleCards()[0];
  if (!card) return;
  card.focus({ preventScroll: true });
  revealCard(card, false);
}

export default function BigScreenControls(props: Props) {
  const { t } = useI18n();
  const latest = useRef(props); latest.current = props;
  const label = useRef<HTMLParagraphElement>(null);
  const { order, query, input } = useBigPictureView();
  const [searching, setSearching] = useState(false);
  const [askExit, setAskExit] = useState(false);
  const ui = useRef({ searching, askExit }); ui.current = { searching, askExit };
  // Every way out asks first (BigExitConfirm); entering is at once.
  const requestToggle = () => { if (latest.current.enabled) setAskExit(true); else latest.current.onToggle(); };
  const actions = useRef({ requestToggle, openSearch: () => setSearching(true) });
  actions.current = { requestToggle, openSearch: () => setSearching(true) };
  useEffect(() => { if (!props.enabled) { setSearching(false); setAskExit(false); } }, [props.enabled]);
  useLayoutEffect(() => { if (props.enabled) labelIn(label.current); }, [props.enabled]);
  // The grid leaves the rail's column free while the mode is on (big-picture-browse.css).
  useEffect(() => {
    document.body.classList.toggle("ga-big-rail-on", props.enabled);
    return () => document.body.classList.remove("ga-big-rail-on");
  }, [props.enabled]);
  // Entering the mode: the first ready card takes the focus, so A or Enter plays something right away.
  useEffect(() => {
    if (!props.enabled) return;
    const timer = window.setTimeout(() => { if (!document.activeElement?.closest(CARDS)) visibleCards()[0]?.focus({ preventScroll: true }); }, 350);
    return () => window.clearTimeout(timer);
  }, [props.enabled]);
  // Another order or search starts the games from the top; outside the search the first card takes the focus.
  const firstRun = useRef(true);
  useEffect(() => {
    if (firstRun.current) { firstRun.current = false; return; }
    if (!latest.current.enabled) return;
    const frame = window.requestAnimationFrame(() => {
      const host = gridHost();
      if (host) { gsap.killTweensOf(host, "scrollTop"); host.scrollTop = 0; }
      if (!ui.current.searching && !document.activeElement?.closest(".ga-big-rail")) visibleCards()[0]?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [order, query]);

  useEffect(() => {
    const input = new GamepadInput(); const arbiter = new InputSourceArbiter();
    const claim = (source: "pad" | "keyboard") => { arbiter.claim(source); if (latest.current.enabled) setBigPictureInput(source); };
    /** Arrows or the stick on the grid: card to card; left of the first column reaches the rail, right of it goes back. */
    const move = (direction: Direction) => {
      latest.current.onDirection();
      if (document.activeElement?.closest(".ga-big-rail")) {
        if (direction === "right") focusGames();
        else if (direction !== "left") focusCard(direction, RAIL);
        return;
      }
      if (!focusCard(direction) && direction === "left") document.querySelector<HTMLElement>('.ga-big-rail [aria-checked="true"]')?.focus();
    };
    const page = (step: 1 | -1) => {
      const host = gridHost();
      if (!host) return;
      const top = Math.max(0, Math.min(host.scrollHeight - host.clientHeight, host.scrollTop + step * host.clientHeight * .7));
      gsap.killTweensOf(host, "scrollTop");
      if (motionOk()) gsap.to(host, { scrollTop: top, duration: .35, ease: "power2.out" }); else host.scrollTop = top;
    };
    const accept = () => {
      const active = document.activeElement as HTMLElement | null;
      // The game on the focused card, read from the card itself; a rail button is pressed.
      const id = Number(active?.closest<HTMLElement>(CARDS)?.dataset.libraryGameId);
      if (id) latest.current.onAccept(id);
      else if (active instanceof HTMLButtonElement) active.click();
      else focusGames();
    };
    /** B or Esc on the games: a search is cleared first; then the mode asks before leaving. */
    const back = () => { if (bigPictureView().query) setBigPictureQuery(""); else actions.current.requestToggle(); };
    const closeSearch = () => { setSearching(false); window.requestAnimationFrame(focusGames); };
    const escape = () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", cancelable: true }));
    const dispatch = (action: PadAction) => {
      const p = latest.current;
      if (!p.enabled) { if (action === "toggle") p.onToggle(); return; }
      const direction = action === "left" || action === "right" || action === "up" || action === "down" ? action : null;
      // A question on the smoke (play, leave): the stick moves between its buttons, A presses, B closes.
      if (document.querySelector(DIALOG)) {
        if (direction) focusCard(direction, `${DIALOG} button`);
        else if (action === "accept") { if (document.activeElement instanceof HTMLButtonElement) document.activeElement.click(); }
        else if (action === "back") escape();
        return;
      }
      // The search: the stick moves over the on-screen keyboard, A types, X deletes, B (or Menu) goes back to the games.
      if (ui.current.searching) {
        if (direction) focusCard(direction, `${SEARCH} button`);
        else if (action === "accept") { if (document.activeElement instanceof HTMLButtonElement) document.activeElement.click(); }
        else if (action === "search") document.querySelector<HTMLButtonElement>(`${SEARCH} [data-key="backspace"]`)?.click();
        else if (action === "back" || action === "toggle") closeSearch();
        return;
      }
      if (direction) move(direction);
      else if (action === "pageup" || action === "pagedown") page(action === "pagedown" ? 1 : -1);
      else if (action === "accept") accept();
      else if (action === "back") back();
      else if (action === "search") actions.current.openSearch();
      else if (action === "filters" || action === "catalog") cycleBigPictureOrder(1);
      else if (action === "library") cycleBigPictureOrder(-1);
      else if (action === "toggle") actions.current.requestToggle();
    };
    // The keyboard, first in line while the mode is on, so the library's own keys (detail, Tab, letters) stay out.
    const onKey = (event: KeyboardEvent) => {
      // The controller's B sends a made-up Esc to the questions: that one is not the keyboard.
      if (!event.isTrusted) return;
      claim("keyboard");
      if (!latest.current.enabled) return;
      if (document.querySelector(DIALOG)) return;  // the question's own keys: Enter, Tab, Esc
      const key = event.key;
      const stop = () => { event.preventDefault(); event.stopPropagation(); };
      if ((event.ctrlKey || event.metaKey) && key.toLowerCase() === "f") {
        stop();
        if (ui.current.searching) document.querySelector<HTMLInputElement>(`${SEARCH} input`)?.focus();
        else actions.current.openSearch();
        return;
      }
      if (ui.current.searching) {
        if (key === "Escape") { stop(); closeSearch(); }
        return;  // typing; Enter is the field's
      }
      if (key === "F11") { stop(); actions.current.requestToggle(); return; }
      if (key === "Escape") { stop(); back(); return; }
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      const direction = ARROWS[key];
      if (direction) { stop(); move(direction); return; }
      if (key === "PageDown" || key === "PageUp") { stop(); page(key === "PageDown" ? 1 : -1); return; }
      if (key === "/") { stop(); actions.current.openSearch(); return; }
      if ((key === "Enter" || key === " ") && document.activeElement?.closest(CARDS)) { stop(); if (!event.repeat) accept(); }
    };
    // A click or the wheel is keyboard-and-mouse mode too: no on-screen keyboard.
    const pointer = () => claim("keyboard");
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("pointerdown", pointer, true);
    window.addEventListener("wheel", pointer, { capture: true, passive: true });
    let frame = 0; let idle = 0; let controller = -1;
    const tick = (now: number) => {
      if (document.visibilityState === "visible" && document.hasFocus()) {
        const pad = Array.from(navigator.getGamepads?.() ?? []).find(pad => pad?.connected && pad.mapping === "standard");
        // The controller is heard only while it owns the input: a fresh press takes over from the keyboard, repeats do not.
        if (pad) {
          if (controller !== pad.index) { input.reset(); controller = pad.index; }
          const actions = input.read(pad, now);
          if (actions.some(action => input.fresh.has(action))) claim("pad");
          if (arbiter.allows("pad")) actions.forEach(dispatch);
        } else { input.reset(); controller = -1; }
      } else input.reset();
      // Poll every frame only while a controller is in use; otherwise check a few times a second.
      if (controller >= 0) frame = requestAnimationFrame(tick);
      else idle = window.setTimeout(() => { frame = requestAnimationFrame(tick); }, 300);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame); window.clearTimeout(idle);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("pointerdown", pointer, true);
      window.removeEventListener("wheel", pointer, true);
    };
  }, []);
  const pad = input === "pad";
  const toggle = <GaIconButton className="ga-big-screen-toggle" icon={props.enabled ? <Minimize size={20} aria-hidden="true" /> : <Maximize size={20} aria-hidden="true" />} label={props.enabled ? t("bigScreenExit") : t("bigScreenEnter")} title={props.enabled ? t("bigScreenExitHint") : t("bigScreenEnterHint")} pressed={props.enabled} onClick={requestToggle} />;
  return <>
    {props.footerTarget ? createPortal(toggle, props.footerTarget.closest(".catalog-bottom-actions")?.querySelector<HTMLElement>(".ga-dock") ?? props.footerTarget.closest(".catalog-bottom-actions") ?? props.footerTarget) : toggle}
    <BigPictureIntro />
    {props.enabled ? <BigPictureRail onSearch={() => setSearching(true)} onExit={() => setAskExit(true)} /> : null}
    {props.enabled && searching ? <BigPictureSearch onClose={() => { setSearching(false); window.requestAnimationFrame(focusGames); }} /> : null}
    {props.enabled && askExit ? <BigExitConfirm onStay={() => setAskExit(false)} onLeave={() => { setAskExit(false); latest.current.onToggle(); }} /> : null}
    {/* The legend, always on screen in the mode: what each button or key does, leaving included. */}
    {props.enabled ? <p ref={label} className="ga-big-picture-label" role="status">{pad ? <Gamepad2 size={20} aria-hidden="true" /> : <Keyboard size={20} aria-hidden="true" />}<strong>{t("bigPictureTitle")}</strong>
      {pad ? <>
        <span className="ga-pad-legend"><span className="ga-pad-key is-a">A</span>{t("bigPicturePlay")}</span>
        <span className="ga-pad-legend"><span className="ga-pad-key"><Move size={15} strokeWidth={2.4} aria-hidden="true" /></span>{t("bigPictureMove")}</span>
        <span className="ga-pad-legend"><span className="ga-pad-key">X</span>{t("bigPictureSearch")}</span>
        <span className="ga-pad-legend"><span className="ga-pad-key">Y</span>{t("bigPictureOrder")}</span>
        <span className="ga-pad-legend is-exit"><MenuKey />{t("bigPictureLeave")}</span>
      </> : <>
        <span className="ga-pad-legend"><kbd className="ga-pad-key">{t("bigKeyEnter")}</kbd>{t("bigPicturePlayKeys")}</span>
        <span className="ga-pad-legend"><kbd className="ga-pad-key">← →</kbd>{t("bigPictureMove")}</span>
        <span className="ga-pad-legend"><kbd className="ga-pad-key">{t("bigKeySearch")}</kbd>{t("bigPictureSearch")}</span>
        <span className="ga-pad-legend is-exit"><kbd className="ga-pad-key">{t("bigKeyEsc")}</kbd>{t("bigPictureLeave")}</span>
      </>}</p> : null}
  </>;
}
