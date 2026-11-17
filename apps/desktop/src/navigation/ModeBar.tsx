import { useLayoutEffect, useRef, useState } from "react";
import { Gamepad2, House, LayoutGrid, Settings } from "lucide-react";
import { gsap, motionOk } from "../motion/gsap";
import { RAIL_PRESETS } from "../components/ga/modeRail/gaModeRail";
import { useI18n } from "../i18n";
import { NAVIGATION, type NavigationModeId } from "./navigationTree";
import { currentCssValue, SHELL_LOOK_EVENT, type WordPrefs } from "./shellLook";

/** Fixed icons (§4.1): they do not change with the style, so each mode is always recognised. */
export const MODE_ICONS = { catalog: LayoutGrid, library: Gamepad2, gameAccess: House, settings: Settings } as const;

type Animation = (word: HTMLElement, ctx: { gsap: typeof gsap; chars: HTMLElement[]; duration: number }) => { then?: (done: () => void) => unknown } | void;
const animation = (name: string, kind: "start" | "end"): Animation => ((RAIL_PRESETS as Record<string, Record<string, Animation>>)[name] ?? RAIL_PRESETS.none)[kind];
const run = (fn: Animation, word: HTMLElement, duration: number) => new Promise<void>(resolve => {
  if (!motionOk()) { resolve(); return; }
  try {
    const result = fn(word, { gsap, chars: [...word.querySelectorAll<HTMLElement>(".ga-nav-word-char")], duration });
    if (result && typeof result.then === "function") result.then(() => resolve()); else resolve();
  } catch { resolve(); }
});

/** The word as large as the bar allows (or the size the player chose), measured on the turned box. */
function fitWord(box: HTMLElement, word: HTMLElement, size: number | null): void {
  if (size !== null) { word.style.fontSize = `${size}px`; return; }
  word.style.fontSize = "100px";
  const rect = word.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const style = getComputedStyle(box);
  const room = box.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
  const fit = Math.min(100 * room / rect.height, 100 * box.clientWidth / rect.width);
  word.style.fontSize = `${Math.max(1, Math.floor(fit))}px`;
}

/** The mode bar (vault/Rediseño de navegación.md §4.1): the current mode's word above, the other three as bands below. */
export default function ModeBar({ mode, word, badges, onOpen }: { mode: NavigationModeId; word: WordPrefs; badges: Partial<Record<NavigationModeId, number>>; onOpen: (mode: NavigationModeId) => void }) {
  const { t } = useI18n();
  const boxRef = useRef<HTMLDivElement>(null);
  const wordRef = useRef<HTMLSpanElement>(null);
  const innerRef = useRef<HTMLSpanElement>(null);
  const bandsRef = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(mode);
  const first = useRef(true);
  const label = t(NAVIGATION.find(item => item.id === shown)!.label);
  const duration = () => word.duration ?? (parseFloat(currentCssValue("--ga-nav-transition-time")) || .6);

  // A mode change: the old word leaves with its animation, then the new one comes in and the bands slide in from the left.
  useLayoutEffect(() => {
    if (mode === shown) return;
    let live = true;
    void run(animation(word.end, "end"), innerRef.current!, duration() * .6).then(() => { if (live) setShown(mode); });
    return () => { live = false; };
  }, [mode]); // eslint-disable-line react-hooks/exhaustive-deps

  useLayoutEffect(() => {
    const box = boxRef.current, el = wordRef.current, inner = innerRef.current;
    if (!box || !el || !inner) return;
    const fit = () => fitWord(box, el, word.size);
    fit();
    gsap.set(inner, { clearProps: "transform,opacity,clipPath" });
    if (!first.current) {
      void run(animation(word.start, "start"), inner, duration());
      if (motionOk() && bandsRef.current) gsap.fromTo(bandsRef.current.children, { xPercent: -110 }, { xPercent: 0, duration: duration(), stagger: duration() * .12, ease: "expo.out", clearProps: "transform" });
    }
    first.current = false;
    const observer = new ResizeObserver(fit);
    observer.observe(box);
    const restyled = () => requestAnimationFrame(() => { fit(); void document.fonts?.ready.then(fit); });
    window.addEventListener(SHELL_LOOK_EVENT, restyled);
    // A style's font loads the first time it is used, after the look changed: fit again when it arrives.
    document.fonts?.addEventListener("loadingdone", fit);
    void document.fonts?.ready.then(fit);
    return () => { observer.disconnect(); window.removeEventListener(SHELL_LOOK_EVENT, restyled); document.fonts?.removeEventListener("loadingdone", fit); };
  }, [shown, word.size, word.font, word.orientation, word.tracking]); // eslint-disable-line react-hooks/exhaustive-deps

  return <nav className="ga-nav-modes" aria-label={t("navModesAria")}>
    <div className="ga-nav-word-box" ref={boxRef} data-align={word.align}>
      <span className="ga-nav-word" ref={wordRef} data-orientation={word.orientation} role="heading" aria-level={1} aria-label={label}>
        <span className="ga-nav-word-in" ref={innerRef} aria-hidden="true">{[...label].map((char, index) => <span key={index} className="ga-nav-word-char">{char === " " ? " " : char}</span>)}</span>
      </span>
    </div>
    <div className="ga-nav-bands" ref={bandsRef}>{NAVIGATION.filter(item => item.id !== mode).map(item => {
      const Icon = MODE_ICONS[item.id];
      const badge = badges[item.id] ?? 0;
      // Fixed order (§4.1): the three other modes keep the tree's order; a count says what waits there.
      return <button key={item.id} type="button" className="ga-nav-band" data-target={item.id} onClick={() => onOpen(item.id)}
        aria-label={badge ? `${t(item.label)} · ${badge}` : t(item.label)} title={t(item.label)}>
        <Icon aria-hidden="true" />{badge > 0 && <em aria-hidden="true">{badge}</em>}
      </button>;
    })}</div>
  </nav>;
}
