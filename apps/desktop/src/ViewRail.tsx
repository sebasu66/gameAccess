import { useEffect, useLayoutEffect, useRef } from "react";
import "@fontsource/archivo-black/400.css";
import { gsap, motionOk } from "./motion/gsap";
import { useI18n } from "./i18n";
import "./view-rail.css";

export type RailView = "catalog" | "library";

/**
 * The name of the current view, huge and vertical on the left edge (docs/GUI_DESIGN.md §4.16): CATALOGO in
 * orange or LIBRERIA in green, 110 % of the window height, smooth outline with a pixelated inside, fading
 * toward the center. Changing view slides the old word up and the new one in from below.
 */
export default function ViewRail({ view }: { view: RailView }) {
  const { t } = useI18n();
  const root = useRef<HTMLDivElement>(null);
  const shown = useRef<RailView>(view);
  const words: Record<RailView, string> = { catalog: t("railCatalog"), library: t("railLibrary") };

  // Each word is sized so its length is 110 % of the window height; the rail reserves the width it takes.
  useLayoutEffect(() => {
    const size = () => {
      const host = root.current;
      if (!host) return;
      let width = 0;
      host.querySelectorAll<HTMLElement>(".ga-rail-word").forEach(word => {
        word.style.fontSize = "100px";
        const length = word.offsetHeight || 1;
        word.style.fontSize = `${100 * window.innerHeight * 1.1 / length}px`;
        width = Math.max(width, word.offsetWidth);
      });
      document.documentElement.style.setProperty("--ga-rail", `${Math.round(width * .92)}px`);
      host.querySelectorAll<HTMLElement>(".ga-rail-word").forEach(word => gsap.set(word, { yPercent: -50, rotation: 180, y: word.dataset.view === shown.current ? 0 : window.innerHeight * 1.3 }));
    };
    size();
    void document.fonts?.ready.then(size);
    window.addEventListener("resize", size);
    return () => { window.removeEventListener("resize", size); document.documentElement.style.removeProperty("--ga-rail"); };
  }, [words.catalog, words.library]);

  useEffect(() => {
    const host = root.current;
    const previous = shown.current;
    if (!host || previous === view) return;
    shown.current = view;
    const out = host.querySelector<HTMLElement>(`.ga-rail-word[data-view="${previous}"]`);
    const into = host.querySelector<HTMLElement>(`.ga-rail-word[data-view="${view}"]`);
    const travel = window.innerHeight * 1.3 * (view === "library" ? 1 : -1);
    if (!motionOk()) { gsap.set(out, { y: travel }); gsap.set(into, { y: 0 }); return; }
    gsap.to(out, { y: -travel, duration: 1.1, ease: "expo.inOut", overwrite: "auto" });
    gsap.fromTo(into, { y: travel }, { y: 0, duration: 1.1, ease: "expo.inOut", overwrite: "auto", delay: .05 });
  }, [view]);

  return (
    <div ref={root} className="ga-view-rail" aria-hidden="true">
      {(Object.keys(words) as RailView[]).map(key => (
        <span key={key} className="ga-rail-word" data-view={key}><span className="solid">{words[key]}</span><span className="pix">{words[key]}</span></span>
      ))}
    </div>
  );
}
