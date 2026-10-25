import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { GaBack, GaClose } from "../components/ga/Buttons";
import CircularScrollbar from "../CircularScrollbar";
import { useI18n } from "../i18n";
import { gsap, motionOk } from "../motion/gsap";
import { closeAllPanels, closePanel, useDesk, useWideDesk, type DeskPanelId } from "./desk";
import "./desk.css";

const SubtitleContext = createContext<((text: string) => void) | null>(null);
/** Lets the panel's content write the subtitle under the panel title (for example "2 pending · 3 completed"). */
export function useDeskSubtitle(text: string) {
  const set = useContext(SubtitleContext);
  useEffect(() => { set?.(text); }, [set, text]);
}

/**
 * A secondary panel (T10). Beside the catalog in a wide window: it slides in from its edge; while the pointer and
 * the focus are elsewhere it turns grey and leans 9° toward the centre, and straightens when used. In a small window
 * it covers the screen with a 3D turn and a Back button; Esc goes back. Its content mounts only while it is open.
 */
export default function DeskPanel({ id, eyebrow, title, children }: { id: DeskPanelId; eyebrow: string; title: string; children: ReactNode }) {
  const { t } = useI18n();
  const panels = useDesk();
  const wide = useWideDesk();
  // In a small window only the last panel opened is shown (the others come back when the window widens).
  const open = wide ? panels.includes(id) : panels[panels.length - 1] === id;
  const [present, setPresent] = useState(open);
  const [subtitle, setSubtitle] = useState("");
  const host = useRef<HTMLElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const side = id === "manager" ? "left" : "right";
  if (open && !present) setPresent(true);

  useLayoutEffect(() => {
    const el = host.current;
    if (!el || !open || !motionOk()) return;
    const tween = wide
      ? gsap.fromTo(el, { xPercent: side === "left" ? -100 : 100 }, { xPercent: 0, duration: .6, ease: "expo.out" })
      : gsap.fromTo(el, { rotationY: -24, x: 90, opacity: 0, transformPerspective: 1400, transformOrigin: "left center" }, { rotationY: 0, x: 0, opacity: 1, duration: .7, ease: "expo.out", clearProps: "transform" });
    return () => { tween.kill(); };
  }, [open, wide]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (open || !present) return;
    const el = host.current;
    if (!el || !motionOk()) { setPresent(false); return; }
    const tween = wide
      ? gsap.to(el, { xPercent: side === "left" ? -100 : 100, duration: .35, ease: "power2.in", onComplete: () => setPresent(false) })
      : gsap.to(el, { rotationY: 24, x: 90, opacity: 0, transformPerspective: 1400, duration: .4, ease: "power2.in", onComplete: () => setPresent(false) });
    return () => { tween.kill(); };
  }, [open, present, wide, side]);

  useEffect(() => {
    if (!open || wide) return;
    const key = (event: KeyboardEvent) => { if (event.key === "Escape" && !event.defaultPrevented) { event.preventDefault(); closeAllPanels(); } };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [open, wide]);

  if (!present) return null;
  const slot = id === "news" ? (panels.includes("downloads") ? "below" : "full") : id === "downloads" && panels.includes("news") ? "above" : "full";
  return createPortal(
    <aside ref={host} className="ga-desk-panel" data-mode={wide ? "panel" : "page"} data-side={side} data-slot={slot} aria-label={title}>
      <div className="ga-desk-card">
        <header className="ga-desk-head">
          <div><span className="ga-desk-eyebrow">{eyebrow}</span><h2>{title}</h2>{subtitle ? <p>{subtitle}</p> : null}</div>
          {wide ? <GaClose label={t("close")} onClick={() => closePanel(id)} /> : <GaBack label={t("back")} onClick={closeAllPanels} />}
        </header>
        <div className="ga-scroll-frame ga-desk-frame">
          <div ref={body} className="ga-desk-body"><SubtitleContext.Provider value={setSubtitle}>{children}</SubtitleContext.Provider></div>
          <CircularScrollbar targetRef={body} label={title} />
        </div>
      </div>
    </aside>,
    document.body,
  );
}
