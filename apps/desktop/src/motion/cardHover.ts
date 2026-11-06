/**
 * Card hover as in the approved demo: the cover lifts, tilts toward the pointer with a soft glare, and the
 * background takes the colour of the game. One set of listeners on the grid serves every card (the catalog grid is
 * virtualized, so cards come and go).
 */
import { useEffect, type RefObject } from "react";
import { gsap, motionOk } from "./gsap";
import { setAmbient } from "./ambient";

function artOf(card: HTMLElement): HTMLElement {
  return card.querySelector<HTMLElement>(".library-room-card-art") ?? card;
}

export function useCardHover(container: RefObject<HTMLElement>): void {
  useEffect(() => {
    const host = container.current;
    if (!host) return;
    let current: HTMLElement | null = null;
    const enter = (card: HTMLElement) => {
      current = card;
      const art = artOf(card);
      const image = art.querySelector("img");
      if (image) setAmbient(image);
      if (!motionOk() || card.closest(".surface-display, .surface-tablet") || card.dataset.revealing) return;
      let glare = art.querySelector<HTMLElement>(":scope > .ga-glare");
      if (!glare) { glare = document.createElement("span"); glare.className = "ga-glare"; glare.setAttribute("aria-hidden", "true"); art.append(glare); }
      gsap.to(art, { y: -8, scale: 1.03, transformPerspective: 800, duration: .4, ease: "power3.out", overwrite: "auto" });
      gsap.to(glare, { opacity: 1, duration: .3 });
    };
    const leave = (card: HTMLElement) => {
      if (current === card) current = null;
      const art = artOf(card);
      gsap.to(art, { y: 0, scale: 1, rotationX: 0, rotationY: 0, duration: .5, ease: "power3.out", overwrite: "auto", clearProps: "transform" });
      const glare = art.querySelector(":scope > .ga-glare");
      if (glare) gsap.to(glare, { opacity: 0, duration: .3 });
    };
    const over = (event: PointerEvent) => {
      const card = (event.target as Element).closest<HTMLElement>("[data-library-game-id]");
      if (card === current) return;
      if (current) leave(current);
      if (card && host.contains(card)) enter(card);
    };
    const move = (event: PointerEvent) => {
      if (!current || !motionOk() || current.dataset.revealing) return;
      const art = artOf(current), r = art.getBoundingClientRect();
      const px = (event.clientX - r.left) / r.width, py = (event.clientY - r.top) / r.height;
      gsap.to(art, { rotationX: (.5 - py) * 14, rotationY: (px - .5) * 16, duration: .5, ease: "power3", overwrite: "auto" });
      const glare = art.querySelector<HTMLElement>(":scope > .ga-glare");
      glare?.style.setProperty("--gx", `${px * 100}%`); glare?.style.setProperty("--gy", `${py * 100}%`);
    };
    const out = (event: PointerEvent) => { if (current && !host.contains(event.relatedTarget as Node | null)) leave(current); };
    host.addEventListener("pointerover", over);
    host.addEventListener("pointermove", move);
    host.addEventListener("pointerout", out);
    return () => { host.removeEventListener("pointerover", over); host.removeEventListener("pointermove", move); host.removeEventListener("pointerout", out); };
  }, [container]);
}
