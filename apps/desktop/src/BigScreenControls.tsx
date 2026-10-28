import { useEffect, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Gamepad2, Maximize, Minimize, Move } from "lucide-react";
import { GamepadInput, type PadAction } from "./gamepadInput";
import { InputSourceArbiter } from "./inputSource";
import { useI18n } from "./i18n";
import { GaIconButton } from "./components/ga/Buttons";
import "./big-picture.css";
import { labelIn } from "./motion/bigPictureMotion";
import BigPictureIntro, { MenuKey } from "./BigPictureIntro";

/**
 * Big picture mode's controls (bigPicture.ts): the footer button, the controller and the label at the bottom centre.
 * The controller only moves between the library's ready-to-play cards, plays the chosen one (A) and leaves the mode
 * (Menu). Nothing else opens: no detail, panels, menus, search or filters.
 */
type Props = { footerTarget?: HTMLDivElement | null; enabled: boolean; onToggle: () => void; onDirection: () => void; onAccept: (gameId: number) => void };

const CARDS = ".ga-bento-card";
const visibleCards = () => Array.from(document.querySelectorAll<HTMLElement>(CARDS)).filter(node => node.getClientRects().length > 0);

/** The nearest card in that direction from the focused one (or the first card when none is focused). */
export function focusCard(direction: "left" | "right" | "up" | "down") {
  const nodes = visibleCards();
  const active = document.activeElement as HTMLElement | null;
  if (!active || !nodes.includes(active)) { nodes[0]?.focus(); nodes[0]?.scrollIntoView({ block: "nearest" }); return; }
  const rect = active.getBoundingClientRect(), x = rect.left + rect.width / 2, y = rect.top + rect.height / 2;
  const next = nodes.filter(node => node !== active).map(node => {
    const r = node.getBoundingClientRect(), dx = r.left + r.width / 2 - x, dy = r.top + r.height / 2 - y;
    const along = direction === "right" ? dx : direction === "left" ? -dx : direction === "down" ? dy : -dy;
    const across = direction === "left" || direction === "right" ? Math.abs(dy) : Math.abs(dx);
    return { node, along, score: along + across * 3 };
  }).filter(item => item.along > 2).sort((a, b) => a.score - b.score)[0]?.node;
  if (!next) return;
  next.focus({ preventScroll: true });
  next.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

export default function BigScreenControls(props: Props) {
  const { t } = useI18n();
  const latest = useRef(props); latest.current = props;
  const label = useRef<HTMLParagraphElement>(null);
  useLayoutEffect(() => { if (props.enabled) labelIn(label.current); }, [props.enabled]);
  // Entering the mode: the first ready card takes the focus, so A plays something right away.
  useEffect(() => {
    if (!props.enabled) return;
    const timer = window.setTimeout(() => { if (!document.activeElement?.closest(CARDS)) visibleCards()[0]?.focus(); }, 350);
    return () => window.clearTimeout(timer);
  }, [props.enabled]);
  useEffect(() => {
    const input = new GamepadInput(); const arbiter = new InputSourceArbiter();
    const keyboardUsed = () => arbiter.claim("keyboard");
    window.addEventListener("keydown", keyboardUsed, true);
    let frame = 0; let idle = 0; let controller = -1;
    const dispatch = (action: PadAction) => {
      const p = latest.current;
      if (action === "toggle") { p.onToggle(); return; }
      if (!p.enabled) return;
      if (action === "left" || action === "right" || action === "up" || action === "down") { p.onDirection(); focusCard(action); }
      else if (action === "pageup" || action === "pagedown") {
        const grid = document.querySelector<HTMLElement>(".library-room-grid");
        grid?.scrollBy({ top: (action === "pagedown" ? 1 : -1) * grid.clientHeight * .7, behavior: "auto" });
      } else if (action === "accept") {
        // The game on the focused card, read from the card itself.
        const id = Number(document.activeElement?.closest<HTMLElement>(CARDS)?.dataset.libraryGameId);
        if (id) p.onAccept(id);
        else visibleCards()[0]?.focus();
      }
      // B, X, Y, LB and RB do nothing in big picture mode.
    };
    const tick = (now: number) => {
      if (document.visibilityState === "visible" && document.hasFocus()) {
        const pad = Array.from(navigator.getGamepads?.() ?? []).find(pad => pad?.connected && pad.mapping === "standard");
        // The controller is heard only while it owns the input: a fresh press takes over from the keyboard, repeats do not.
        if (pad) {
          if (controller !== pad.index) { input.reset(); controller = pad.index; }
          const actions = input.read(pad, now);
          if (actions.some(action => input.fresh.has(action))) arbiter.claim("pad");
          if (arbiter.allows("pad")) actions.forEach(dispatch);
        } else { input.reset(); controller = -1; }
      } else input.reset();
      // Poll every frame only while a controller is in use; otherwise check a few times a second.
      if (controller >= 0) frame = requestAnimationFrame(tick);
      else idle = window.setTimeout(() => { frame = requestAnimationFrame(tick); }, 300);
    };
    frame = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(frame); window.clearTimeout(idle); window.removeEventListener("keydown", keyboardUsed, true); };
  }, []);
  const toggle = <GaIconButton className="ga-big-screen-toggle" icon={props.enabled ? <Minimize size={20} aria-hidden="true" /> : <Maximize size={20} aria-hidden="true" />} label={props.enabled ? t("bigScreenExit") : t("bigScreenEnter")} title={props.enabled ? t("bigScreenExitHint") : t("bigScreenEnterHint")} pressed={props.enabled} onClick={props.onToggle} />;
  return <>
    {props.footerTarget ? createPortal(toggle, props.footerTarget.closest(".catalog-bottom-actions")?.querySelector<HTMLElement>(".ga-dock") ?? props.footerTarget.closest(".catalog-bottom-actions") ?? props.footerTarget) : toggle}
    <BigPictureIntro />
    {/* The controller's legend, always on screen in the mode: what each button does, leaving included. */}
    {props.enabled ? <p ref={label} className="ga-big-picture-label" role="status"><Gamepad2 size={20} aria-hidden="true" /><strong>{t("bigPictureTitle")}</strong>
      <span className="ga-pad-legend"><span className="ga-pad-key is-a">A</span>{t("bigPicturePlay")}</span>
      <span className="ga-pad-legend"><span className="ga-pad-key"><Move size={15} strokeWidth={2.4} aria-hidden="true" /></span>{t("bigPictureMove")}</span>
      <span className="ga-pad-legend is-exit"><MenuKey />{t("bigPictureLeave")}</span></p> : null}
  </>;
}
