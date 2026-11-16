import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { useGSAP } from "@gsap/react";
import { useI18n, type TranslationKey } from "../i18n";
import { usePlus } from "../kidMode";
import { gsap } from "../motion/gsap";
import { queueTransition } from "../motion/transitions";
import { NAVIGATION, type NavigationModeId } from "./navigationTree";
import { planLocked } from "./planLocks";
import { PlanLock } from "./pieces";
import { SCENE_SECTION_ICONS } from "./sceneSectionIcons";
import { useFigureSrc } from "./sceneLook";
import SceneLookMenu, { type SceneMenuRequest } from "./SceneLookMenu";
import { useShellLook } from "./shellLook";

const scene: Record<NavigationModeId, { phrase: TranslationKey }> = {
  catalog: { phrase: "sceneCatalogPhrase" },
  library: { phrase: "sceneLibraryPhrase" },
  gameAccess: { phrase: "sceneGameAccessPhrase" },
  settings: { phrase: "sceneSettingsPhrase" },
};
gsap.registerPlugin(useGSAP);

// Same seeded placement as the prototype, kept stable across renders and modes.
function sceneParticles(): CSSProperties[] {
  let seed = 23;
  const random = () => (seed = seed * 16807 % 2147483647) / 2147483647;
  return Array.from({ length: 9 }, (_, index) => {
    const size = 6 + random() * random() * 50, near = index % 3 === 0;
    return {
      left: `${(random() * 104 - 2).toFixed(1)}%`, top: `${(random() * 52).toFixed(1)}%`,
      width: `${size.toFixed(0)}px`, height: `${size.toFixed(0)}px`,
      "--ga-particle-blur": `${(near ? 6 + random() * 8 : 1.5 + random() * 4).toFixed(1)}px`,
      "--ga-particle-opacity": (.18 + random() * .5).toFixed(2),
      "--ga-particle-duration": `${(9 + random() * 14).toFixed(1)}s`,
      "--ga-particle-delay": `-${(random() * 12).toFixed(1)}s`,
      "--ga-particle-color": random() > .6 ? "var(--ga-scene-particle-white)" : "var(--ga-mode)",
    } as CSSProperties;
  });
}
const particles = sceneParticles();

/** Escena's mode artwork and section list. Existing navigation and plan rules remain the source of behavior. */
export default function SceneNavigation({ mode, selected, reachable, onOpen, onLocked }: {
  mode: NavigationModeId; selected: string; reachable: (section: string) => boolean;
  onOpen: (section: string) => void; onLocked: () => void;
}) {
  const { t } = useI18n();
  const plus = usePlus();
  const current = NAVIGATION.find(item => item.id === mode)!;
  const number = String(NAVIGATION.findIndex(item => item.id === mode) + 1).padStart(2, "0");
  const root = useRef<HTMLElement>(null);
  const word = useRef<HTMLSpanElement>(null);
  const frontWord = useRef<HTMLSpanElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const previousMode = useRef(mode);
  // The player's figure for this mode (Settings › Appearance) and the right-click menus (SceneLookMenu).
  const figure = useShellLook().scene.figures[mode];
  const figureSrc = useFigureSrc(mode, figure?.image);
  const figureStyle = figure ? { "--ga-scene-figure-scale": figure.scale, "--ga-scene-figure-x": `${figure.x}%`, "--ga-scene-figure-y": `${figure.y}%` } as CSSProperties : undefined;
  const [lookMenu, setLookMenu] = useState<SceneMenuRequest | null>(null);
  useEffect(() => {
    const scene = root.current;
    const stage = scene?.closest<HTMLElement>(".ga-nav-shell");
    if (!scene || !stage) return;
    let frame = 0, x = 0, y = 0;
    const reset = () => { cancelAnimationFrame(frame); frame = 0; scene.style.setProperty("--ga-scene-pointer-x", "0"); scene.style.setProperty("--ga-scene-pointer-y", "0"); };
    const move = (event: PointerEvent) => {
      if (event.pointerType === "touch") return;
      const bounds = stage.getBoundingClientRect();
      x = (event.clientX - bounds.left) / bounds.width * 2 - 1;
      y = (event.clientY - bounds.top) / bounds.height * 2 - 1;
      if (!frame) frame = requestAnimationFrame(() => {
        frame = 0;
        scene.style.setProperty("--ga-scene-pointer-x", x.toFixed(3));
        scene.style.setProperty("--ga-scene-pointer-y", y.toFixed(3));
      });
    };
    const leave = (event: PointerEvent) => { if (!event.relatedTarget) reset(); };
    window.addEventListener("pointermove", move, { capture: true, passive: true });
    document.addEventListener("pointerout", leave);
    window.addEventListener("blur", reset);
    return () => { cancelAnimationFrame(frame); window.removeEventListener("pointermove", move, true); document.removeEventListener("pointerout", leave); window.removeEventListener("blur", reset); };
  }, []);
  useLayoutEffect(() => {
    if (!root.current || !word.current || !frontWord.current || !menu.current) return;
    const container = root.current, label = word.current, front = frontWord.current, panel = menu.current;
    let mounted = true;
    const fit = () => {
      if (!mounted) return;
      label.style.fontSize = "";
      front.style.fontSize = "";
      const size = parseFloat(getComputedStyle(label).fontSize);
      const wordGap = parseFloat(getComputedStyle(panel).getPropertyValue("--ga-scene-word-gap")) || 0;
      const room = Math.max(1, panel.offsetTop - label.offsetTop - wordGap);
      if (label.offsetHeight > room) label.style.fontSize = `${Math.floor(size * room / label.offsetHeight)}px`;
      front.style.fontSize = label.style.fontSize;
      const active = panel.querySelector<HTMLElement>('.ga-scene-section[aria-current="page"]');
      if (active) {
        const panelRect = panel.getBoundingClientRect(), rowRect = active.getBoundingClientRect();
        const scale = panelRect.width / (panel.offsetWidth || 1) || 1;
        const y = (rowRect.top - panelRect.top) / scale;
        panel.querySelectorAll<SVGRectElement>(".ga-scene-liquid-cut").forEach(cut => {
          cut.style.y = `${y}px`;
          cut.style.height = `${rowRect.height / scale}px`;
        });
        const edge = panel.querySelector<SVGRectElement>(".ga-scene-liquid-edge");
        if (edge) {
          const bleed = parseFloat(getComputedStyle(panel).getPropertyValue("--ga-scene-bridge-bleed")) || 0;
          edge.style.y = `${y - bleed}px`;
          edge.style.height = `${rowRect.height / scale + bleed * 2}px`;
        }
      }
      const button = document.querySelector<HTMLElement>('.ga-scene-mode[aria-current="page"]');
      if (button) {
        const panelRect = panel.getBoundingClientRect(), buttonRect = button.getBoundingClientRect();
        const scale = panelRect.width / (panel.offsetWidth || 1) || 1;
        panel.style.setProperty("--ga-scene-lobe-x", `${(buttonRect.left + buttonRect.width / 2 - panelRect.left) / scale}px`);
        panel.style.setProperty("--ga-scene-lobe-center", `${(buttonRect.top + buttonRect.height / 2 - panelRect.bottom) / scale}px`);
      }
    };
    const observer = new ResizeObserver(fit);
    observer.observe(container); observer.observe(panel);
    const dock = document.querySelector<HTMLElement>(".ga-scene-dock");
    if (dock) { observer.observe(dock); dock.querySelectorAll<HTMLElement>(".ga-scene-mode").forEach(button => observer.observe(button)); }
    fit(); void document.fonts.ready.then(fit);
    return () => { mounted = false; observer.disconnect(); };
  }, [mode, selected, t]);
  useGSAP((_, contextSafe) => {
    if (previousMode.current === mode) return;
    const direction = NAVIGATION.findIndex(item => item.id === mode) > NAVIGATION.findIndex(item => item.id === previousMode.current) ? 1 : -1;
    previousMode.current = mode;
    if (!contextSafe) return;
    let live = true;
    // Mode changes initiated by a screen already use the shared queue; the new scene enters after that step.
    const enter = contextSafe(() => {
      const container = root.current;
      if (!live || !container) return;
      const figure = container.querySelector(".ga-scene-art img");
      const letters = container.querySelectorAll(".ga-scene-word > span");
      const ring = container.querySelector(".ga-scene-ring");
      const ringStroke = container.querySelector(".ga-scene-ring-main");
      const rows = container.querySelectorAll(".ga-scene-menu-head > *, .ga-scene-section");
      const wipe = container.querySelector(".ga-scene-wipe");
      const selection = container.querySelector(".ga-scene-selection-shape");
      const dockImage = container.closest(".ga-nav-shell")?.querySelector(`.ga-scene-mode[data-target="${mode}"] img`);
      return gsap.timeline({ defaults: { ease: "power3.out" } })
        .to(wipe, { opacity: 0, duration: .5, ease: "power1.out", clearProps: "opacity" }, 0)
        .fromTo(figure, { scale: .82, x: -40 * direction, y: 24, opacity: 0, filter: "blur(20px)" }, { scale: 1, x: 0, y: 0, opacity: 1, filter: "blur(0px)", duration: .9, clearProps: "transform,opacity,filter" }, .05)
        .fromTo(letters, { xPercent: 140, opacity: 0 }, { xPercent: 0, opacity: 1, duration: .6, stagger: .03, ease: "back.out(1.6)", clearProps: "transform,opacity" }, .1)
        .fromTo(ring, { opacity: 0 }, { opacity: 1, duration: .3, clearProps: "opacity" }, .25)
        .fromTo(ringStroke, { strokeDashoffset: 100 }, { strokeDashoffset: 0, duration: 1, ease: "power2.inOut", clearProps: "strokeDashoffset" }, .25)
        .fromTo(rows, { x: -22, opacity: 0 }, { x: 0, opacity: 1, duration: .5, stagger: .05, clearProps: "transform,opacity" }, .3)
        .fromTo(selection, { opacity: 0 }, { opacity: 1, duration: .35, clearProps: "opacity" }, .5)
        .fromTo(dockImage ?? [], { rotation: -90, scale: .7 }, { rotation: 0, scale: 1, duration: .8, ease: "back.out(1.8)", clearProps: "transform" }, .05);
    });
    void queueTransition(enter, "scene-mode-enter");
    return () => { live = false; };
  }, { scope: root, dependencies: [mode], revertOnUpdate: true });
  return <nav className="ga-scene-navigation" ref={root} aria-label={t("navSectionsAria")} onContextMenu={event => {
    event.preventDefault();
    // On the menu: its colours; anywhere above it (the figure, the word): the figure.
    const kind = (event.target as Element).closest(".ga-scene-menu") ? "colors" : "figure";
    setLookMenu({ kind, x: event.clientX, y: event.clientY, mode });
  }}>
    <div className="ga-scene-art" aria-hidden="true">
      <span className="ga-scene-art-glow" />
      <span className="ga-scene-art-number">{number}</span>
      <span className="ga-scene-word" ref={word}>{[...t(current.label)].map((character, index) => <span key={index}>{character === " " ? " " : character}</span>)}</span>
      <span className="ga-scene-ring"><svg viewBox="0 0 300 300" aria-hidden="true"><circle className="ga-scene-ring-main" cx="150" cy="150" r="132" pathLength="100" /><g className="ga-scene-ring-orbit"><circle cx="150" cy="150" r="147" /><path d="M297 150a147 147 0 0 0-147-147" /></g></svg></span>
      <img src={figureSrc} alt="" style={figureStyle} />
      <span className="ga-scene-word ga-scene-word-front" ref={frontWord}>{[...t(current.label)].map((character, index) => <span key={index} data-under={index >= 2 && index % 2 === 0 || undefined}>{character === " " ? " " : character}</span>)}</span>
    </div>
    <span className="ga-scene-particles" aria-hidden="true">{particles.map((style, index) => <i key={index} className={index % 3 === 0 ? "is-near" : "is-far"} style={style} />)}</span>
    <div className="ga-scene-menu" ref={menu}>
      <div className="ga-scene-figure-smoke" aria-hidden="true"><i /><b /></div>
      <svg className="ga-scene-liquid" aria-hidden="true">
        <defs>
          <linearGradient id="ga-scene-panel-gradient" gradientUnits="userSpaceOnUse" x1="15%" y1="42%" x2="80%" y2="100%">
            <stop offset="0%" stopColor="var(--ga-scene-gradient-start)" />
            <stop offset="50%" stopColor="var(--ga-scene-surface)" />
            <stop offset="100%" stopColor="var(--ga-scene-gradient-end)" />
          </linearGradient>
          <filter id="ga-scene-liquid-filter" x="-20%" y="-20%" width="140%" height="160%">
            <feGaussianBlur in="SourceGraphic" stdDeviation="10" result="blur" />
            <feColorMatrix in="blur" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 22 -9" />
          </filter>
          <mask id="ga-scene-menu-mask">
            <rect x="-50%" y="-50%" width="200%" height="200%" fill="white" />
            <rect className="ga-scene-liquid-cut" height="0" fill="black" />
          </mask>
        </defs>
        <g className="ga-scene-selection-shape" fill="var(--ga-nav-stage-base)" filter="url(#ga-scene-liquid-filter)">
          <rect className="ga-scene-liquid-cut" height="0" />
          <rect className="ga-scene-liquid-edge" height="0" />
        </g>
        <g fill="url(#ga-scene-panel-gradient)" filter="url(#ga-scene-liquid-filter)">
          <rect className="ga-scene-liquid-body" width="100%" height="100%" mask="url(#ga-scene-menu-mask)" />
          <rect className="ga-scene-liquid-neck" mask="url(#ga-scene-menu-mask)" />
          <circle className="ga-scene-liquid-lobe" />
        </g>
      </svg>
      <header className="ga-scene-menu-head"><span>{number}</span><strong>{t(scene[mode].phrase)}</strong></header>
      <ul className="ga-scene-list">{current.sections.map(section => {
        const active = section.id === selected;
        const locked = planLocked(plus, section.id);
        return <li key={section.id}><button type="button" className="ga-scene-section" aria-current={active ? "page" : undefined}
          disabled={!locked && !reachable(section.id)} onClick={() => { if (locked) onLocked(); else if (!active) onOpen(section.id); }}>
          <span className="ga-scene-section-icon" aria-hidden="true">{SCENE_SECTION_ICONS[section.id]}</span>
          <span className="ga-scene-section-copy"><strong>{t(section.label)}</strong><small>{t(section.desc)}</small></span>
          {locked && <PlanLock />}
        </button></li>;
      })}</ul>
    </div>
    <div className="ga-scene-wipe" aria-hidden="true"><div className="ga-scene-wipe-liquid"><i /><i /><i /></div></div>
    {lookMenu && <SceneLookMenu request={lookMenu} onClose={() => setLookMenu(null)} />}
  </nav>;
}
