import { useLayoutEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { gsap, motionOk } from "../../motion/gsap";

/**
 * A screen (docs/GUI_DESIGN.md §0b and §4.12): it fills the app's area inside the frame, above the games, with no
 * backdrop and no close button. Header like a panel's (eyebrow, Bebas title, subtitle), then its content, centred.
 * It is born hidden: the change of mode (appScreen.ts, through the transition queue) brings it in from below.
 */
export default function GaScreen({ id, title, subtitle, className, children }: { id: string; title: string; subtitle?: string; className?: string; children: ReactNode }) {
  const root = useRef<HTMLElement>(null);
  useLayoutEffect(() => { if (root.current && motionOk()) gsap.set(root.current, { opacity: 0 }); }, []);
  return createPortal(<section ref={root} className={className ? `ga-screen ${className}` : "ga-screen"} aria-labelledby={`${id}-title`} data-screen={id}>
    <header className="ga-screen-head"><span className="eyebrow">GAME ACCESS</span><h2 id={`${id}-title`} className="ga-heading">{title}</h2>{subtitle ? <p className="ga-hint">{subtitle}</p> : null}</header>
    <div className="ga-screen-body">{children}</div>
  </section>, document.body);
}
