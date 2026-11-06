/**
 * Magnetic buttons as in the approved demo: the button leans toward the pointer, sinks on press and springs back.
 * One set of listeners on the container serves every button inside it (their contents re-render).
 */
import { useEffect, type RefObject } from "react";
import { gsap, motionOk } from "./gsap";

export function useMagneticButtons(container: RefObject<HTMLElement>): void {
  useEffect(() => {
    const host = container.current;
    if (!host) return;
    const buttonOf = (event: Event) => (event.target as Element).closest<HTMLElement>("button");
    const move = (event: PointerEvent) => {
      const el = buttonOf(event);
      if (!el || !host.contains(el) || !motionOk()) return;
      const r = el.getBoundingClientRect();
      gsap.to(el, { x: (event.clientX - r.left - r.width / 2) * .25, y: (event.clientY - r.top - r.height / 2) * .3, duration: .4, ease: "power3", overwrite: "auto" });
    };
    const leave = (event: PointerEvent) => {
      const el = buttonOf(event);
      if (el && !el.contains(event.relatedTarget as Node | null)) gsap.to(el, { x: 0, y: 0, duration: .4, ease: "power3", overwrite: "auto" });
    };
    const down = (event: PointerEvent) => { const el = buttonOf(event); if (el && motionOk()) gsap.to(el, { scale: .95, duration: .12 }); };
    const up = (event: PointerEvent) => { const el = buttonOf(event); if (el && motionOk()) gsap.to(el, { scale: 1, duration: .5, ease: "elastic.out(1,.4)" }); };
    host.addEventListener("pointermove", move);
    host.addEventListener("pointerout", leave);
    host.addEventListener("pointerdown", down);
    host.addEventListener("pointerup", up);
    return () => {
      host.removeEventListener("pointermove", move); host.removeEventListener("pointerout", leave);
      host.removeEventListener("pointerdown", down); host.removeEventListener("pointerup", up);
    };
  }, [container]);
}
