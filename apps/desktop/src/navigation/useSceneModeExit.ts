import { useEffect, useRef, type RefObject } from "react";
import { useGSAP } from "@gsap/react";
import { gsap } from "../motion/gsap";
import { queueTransition } from "../motion/transitions";
import { NAVIGATION, type NavigationModeId } from "./navigationTree";

const colorRole: Record<NavigationModeId, string> = {
  catalog: "--ga-scene-catalog", library: "--ga-scene-library", gameAccess: "--ga-scene-game-access", settings: "--ga-scene-settings",
};

/** Exit first, release the queue, then request the screen. Screen changes also use that queue. */
export function useSceneModeExit(root: RefObject<HTMLDivElement>, mode: NavigationModeId, open: (mode: NavigationModeId) => void) {
  const alive = useRef(true);
  const pending = useRef(false);
  const desired = useRef(mode);
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const { contextSafe } = useGSAP({ scope: root });
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  return (target: NavigationModeId) => {
    desired.current = target;
    if (pending.current || target === modeRef.current) return;
    pending.current = true;
    const exit = contextSafe(() => {
      const container = root.current;
      if (!alive.current || !container) return;
      const scene = container.querySelector<HTMLElement>(".ga-scene-navigation");
      const wipe = scene?.querySelector<HTMLElement>(".ga-scene-wipe");
      const dock = container.querySelector<HTMLElement>(`.ga-scene-mode[data-target="${desired.current}"]`);
      if (!scene || !wipe || !dock) return;
      const targetColor = getComputedStyle(container).getPropertyValue(colorRole[desired.current]).trim();
      const x = dock.getBoundingClientRect().left + dock.getBoundingClientRect().width / 2 - scene.getBoundingClientRect().left;
      wipe.style.setProperty("--ga-scene-wipe-color", targetColor);
      wipe.style.setProperty("--ga-scene-wipe-x", `${x}px`);
      const letters = scene.querySelectorAll(".ga-scene-word > span");
      const figure = scene.querySelector(".ga-scene-art img");
      const ring = scene.querySelector(".ga-scene-ring");
      const rows = scene.querySelectorAll(".ga-scene-menu-head > *, .ga-scene-section");
      const selection = scene.querySelector(".ga-scene-selection-shape");
      const circles = wipe.querySelectorAll("i");
      const direction = NAVIGATION.findIndex(item => item.id === desired.current) > NAVIGATION.findIndex(item => item.id === modeRef.current) ? 1 : -1;
      return gsap.timeline({ defaults: { ease: "power2.in" } })
        .to(letters, { xPercent: -140, opacity: 0, duration: .3, stagger: .018 }, 0)
        .to(figure, { x: 90 * direction, opacity: 0, filter: "blur(16px)", duration: .36 }, 0)
        .to(ring, { opacity: 0, duration: .25 }, 0)
        .to(rows, { x: -16, opacity: 0, duration: .22, stagger: .015 }, 0)
        .to(selection, { opacity: 0, duration: .2 }, 0)
        .set(wipe, { opacity: 1 }, .12)
        .fromTo(circles, { scale: 0 }, { scale: 1, duration: .5, ease: "power2.inOut", stagger: .07 }, .12);
    });
    void queueTransition(exit, "scene-mode-exit").then(() => {
      pending.current = false;
      if (alive.current) open(desired.current);
    });
  };
}
