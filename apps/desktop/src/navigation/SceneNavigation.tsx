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
import { useFigureDrop } from "./useFigureDrop";
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
  // An image dropped on the character becomes this mode's figure, placed by itself (useFigureDrop.ts).
  const drop = useFigureDrop(mode);
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
    const cutAnimations = new Map<SVGPathElement, gsap.core.Tween>();
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
        const width = panel.offsetWidth;
        const middle = y + rowRect.height / scale / 2;
        const styles = getComputedStyle(panel);
        const gap = parseFloat(styles.getPropertyValue("--ga-scene-column-space"));
        const height = panel.offsetHeight;
        const dockButtons = Array.from(container.closest(".ga-nav-shell")!.querySelectorAll<HTMLElement>(".ga-scene-mode"));
        if (!dockButtons.length) return;
        const corner = Math.min(parseFloat(styles.getPropertyValue("--ga-scene-panel-radius")), width / 8);
        const half = rowRect.height / scale / 2;
        const head = half + 4, throat = half * .87;
        const icon = active.querySelector<HTMLElement>(".ga-scene-section-icon")!;
        const eye = active.offsetLeft + parseFloat(getComputedStyle(active).paddingLeft) + icon.offsetWidth / 2;
        const lip = Math.min(gap * .55, (height - middle - throat) / 2, (middle - throat - corner) / 2);
        const upper = middle - throat, lower = middle + throat;
        const shoulder = eye + head * 2.7;
        // Trace the selection from its lower lip, around the icon, back to the upper lip.
        const drop = [
          `H ${shoulder} C ${eye + head} ${lower} ${eye + head * .8} ${middle + head} ${eye} ${middle + head}`,
          `A ${head} ${head} 0 0 1 ${eye} ${middle - head}`,
          `C ${eye + head * .8} ${middle - head} ${eye + head} ${upper} ${shoulder} ${upper}`,
        ].join(" ");
        const opening = [
          `C ${width} ${lower + lip * .35} ${width - lip} ${lower} ${width - 3 * lip} ${lower}`,
          drop,
          `H ${width - 3 * lip} C ${width - lip} ${upper} ${width} ${upper - lip * .35} ${width} ${upper - lip}`,
        ].join(" ");
        const dock = dockButtons.map(button => {
          const rect = button.getBoundingClientRect();
          return { x: (rect.left + rect.width / 2 - panelRect.left) / scale,
            y: (rect.top + rect.height / 2 - panelRect.top) / scale,
            r: rect.width / scale / 2, active: button.hasAttribute("aria-current") };
        });
        const rim = Math.min(width / 32, (height - lower - lip) * .65);
        /**
         * The hem over the dock, traced off Seba's second drawing (2026-11-19): a **straight** hem that runs above
         * every button, `HEM r` over their centres, so the dock reads as a bar of its own and the buttons stay in it.
         *
         * Every button dents it, always with a circle **centred on the button itself**, so the dent has the button's
         * own roundness (Seba, 2026-11-19): the one in use pulls the hem **down** into a drop that closes under it
         * (a collar of `COLLAR r`, smaller than the hem's height, so the goo wraps the button); every other one
         * pushes it **up** into a shallow notch (`NOTCH r`, a little wider than the hem's height, so the colour only
         * lifts off the button). Both are joined to the straight hem by a neck of `NECK r`, and both are six cubics.
         */
        const HEM = 1.2, NECK = .27, COLLAR = 1.18, NOTCH = 1.45;
        /** The hem's height, the same from end to end: it clears every button by `HEM r - r`. */
        const gapAt = (_: number) => dock[0].y - dock[0].r * HEM;
        /** A piece of a circle as cubics, from angle `a0` to `a1` (0 is the bottom of the circle, 90° its right side). */
        const arc = (cx: number, cy: number, radius: number, a0: number, a1: number, pieces: number) =>
          Array.from({ length: pieces }, (_, piece) => {
            const from = a0 + (a1 - a0) * piece / pieces, to = a0 + (a1 - a0) * (piece + 1) / pieces;
            const hand = radius * 4 / 3 * Math.tan((to - from) / 4);
            const ax = cx + radius * Math.sin(from), ay = cy + radius * Math.cos(from);
            const bx = cx + radius * Math.sin(to), by = cy + radius * Math.cos(to);
            return `C ${ax + hand * Math.cos(from)} ${ay - hand * Math.sin(from)} ${bx - hand * Math.cos(to)} ${by + hand * Math.sin(to)} ${bx} ${by}`;
          });
        /** Half of the wave as a cosine, flat at both ends, cut into `pieces` cubics. */
        const wave = (x0: number, y0: number, x1: number, y1: number, pieces: number) => {
          const span = x1 - x0 || 1;
          const at = (u: number) => y0 + (y1 - y0) * (1 - Math.cos(Math.PI * u)) / 2;
          const slope = (u: number) => (y1 - y0) * Math.PI * Math.sin(Math.PI * u) / (2 * span);
          const run = span / pieces / 3;
          return Array.from({ length: pieces }, (_, piece) => {
            const u0 = piece / pieces, u1 = (piece + 1) / pieces;
            const ax = x0 + span * u0, bx = x0 + span * u1;
            return `C ${ax + run} ${at(u0) + run * slope(u0)} ${bx - run} ${at(u1) - run * slope(u1)} ${bx} ${at(u1)}`;
          });
        };
        /*
         * One dent, with no corner anywhere (Seba, 2026-11-19): the straight hem and the bulb are joined the way two
         * drops of liquid join, by a circle of `NECK r` that touches both —the hem from one side, the bulb from
         * outside—, so every piece leaves the one before it along the same tangent.
         *
         * `down` is +1 under the button in use (the bulb's circle is **inside** the hem's height, so the colour falls
         * past the button and closes under it) and -1 over every other one (the bulb is **outside** it, so the colour
         * only lifts off the button and the hem stays near). Six cubics either way, which is what lets GSAP morph one
         * silhouette into the other when the mode changes.
         */
        const dent = (x: number, y: number, r: number, hem: number, start: number, end: number, down: number) => {
          const bulb = r * (down > 0 ? COLLAR : NOTCH), high = r * HEM;
          // The neck is `NECK r`, and no wider than the room left to the neighbouring button.
          const reach = (Math.min(x - start, end - x) * .9) ** 2;
          const fillet = Math.max(r * .1, Math.min(r * NECK, (reach - bulb * bulb + high * high) / (2 * (bulb + down * high))));
          const dx = Math.sqrt(Math.max(1, bulb * bulb - high * high + 2 * fillet * (bulb + down * high)));
          const hemAngle = down > 0 ? Math.PI : 0;                 // where the neck sits on the straight hem
          const bite = Math.atan2(dx, high - down * fillet);       // where the neck lets go of the hem, from its centre
          const grip = down > 0 ? Math.atan2(-dx, fillet - high)   // and where the bulb takes over, from the button's
            : bite - Math.PI;
          return [
            ...wave(start, hem, x - dx, hem, 1),
            ...arc(x - dx, hem + down * fillet, fillet, hemAngle, bite, 1),
            ...arc(x, y, bulb, grip, down > 0 ? -grip : -bite - Math.PI, 2),
            ...arc(x + dx, hem + down * fillet, fillet, -bite, -hemAngle, 1),
            ...wave(x + dx, hem, end, hem, 1),
          ];
        };
        const bottom = [`M 0 ${height - rim * 2} Q 0 ${gapAt(-1)} ${rim} ${gapAt(-1)}`];
        dock.forEach(({ x, y, r, active }, i) => {
          const start = i ? (x + dock[i-1].x) / 2 : rim;
          const end = i + 1 < dock.length ? (x + dock[i+1].x) / 2 : width - rim;
          bottom.push(...dent(x, y, r, gapAt(i), start, end, active ? 1 : -1));
        });
        const body = [...bottom, `Q ${width} ${gapAt(dock.length - 1)} ${width} ${height-rim*2} V ${lower+lip}`,
          opening, `V ${corner} Q ${width} 0 ${width-corner} 0 H ${corner} Q 0 0 0 ${corner} Z`].join(" ");
        // In the gutter the bridge flares until it meets the vertical stage edge tangentially.
        const stage = width + gap;
        const bridge = [
          `M ${width - 3 * lip} ${lower}`, drop,
          `H ${width - 3 * lip} C ${width + gap * .3} ${upper} ${stage} ${upper - gap * .48} ${stage} ${upper - gap * 1.45}`,
          `H ${stage+2} V ${lower + gap * 1.45} H ${stage}`,
          `C ${stage} ${lower + gap * .48} ${width + gap * .3} ${lower} ${width - 3 * lip} ${lower} Z`,
        ].join(" ");
        for (const [selector, d] of [[".ga-scene-liquid-body", body], [".ga-scene-liquid-cut", bridge]]) {
          const shape = panel.querySelector<SVGPathElement>(selector)!;
          cutAnimations.get(shape)?.kill();
          if (!shape.hasAttribute("d")) shape.setAttribute("d", d);
          else cutAnimations.set(shape, gsap.to(shape, { attr: { d }, duration: .55, ease: "power3.inOut" }));
        }
      }
    };
    const observer = new ResizeObserver(fit);
    observer.observe(container); observer.observe(panel);
    const dock = document.querySelector<HTMLElement>(".ga-scene-dock");
    if (dock) { observer.observe(dock); dock.querySelectorAll<HTMLElement>(".ga-scene-mode").forEach(button => observer.observe(button)); }
    fit(); void document.fonts.ready.then(fit);
    return () => { mounted = false; observer.disconnect(); cutAnimations.forEach(tween => tween.kill()); };
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
      const dockMotion = container.closest(".ga-nav-shell")?.querySelector(`.ga-scene-mode[data-target="${mode}"] .ga-scene-mode-motion`);
      return gsap.timeline({ defaults: { ease: "power3.out" } })
        .to(wipe, { opacity: 0, duration: .5, ease: "power1.out", clearProps: "opacity" }, 0)
        .fromTo(figure, { scale: .82, x: -40 * direction, y: 24, opacity: 0, filter: "blur(20px)" }, { scale: 1, x: 0, y: 0, opacity: 1, filter: "blur(0px)", duration: .9, clearProps: "transform,opacity,filter" }, .05)
        .fromTo(letters, { xPercent: 140, opacity: 0 }, { xPercent: 0, opacity: 1, duration: .6, stagger: .03, ease: "back.out(1.6)", clearProps: "transform,opacity" }, .1)
        .fromTo(ring, { opacity: 0 }, { opacity: 1, duration: .3, clearProps: "opacity" }, .25)
        .fromTo(ringStroke, { strokeDashoffset: 100 }, { strokeDashoffset: 0, duration: 1, ease: "power2.inOut", clearProps: "strokeDashoffset" }, .25)
        .fromTo(rows, { x: -22, opacity: 0 }, { x: 0, opacity: 1, duration: .5, stagger: .05, clearProps: "transform,opacity" }, .3)
        .fromTo(selection, { opacity: 0 }, { opacity: 1, duration: .35, clearProps: "opacity" }, .5)
        .fromTo(dockMotion ?? [], { rotation: -90, scale: .7 }, { rotation: 0, scale: 1, duration: .8, ease: "back.out(1.8)", clearProps: "transform" }, .05);
    });
    void queueTransition(enter, "scene-mode-enter");
    return () => { live = false; };
  }, { scope: root, dependencies: [mode], revertOnUpdate: true });
  return <nav className="ga-scene-navigation" ref={root} aria-label={t("navSectionsAria")} data-dropping={drop.over || undefined} {...drop.handlers} onContextMenu={event => {
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
      <img src={figureSrc} alt="" className={figureSrc.startsWith("blob:") ? undefined : "ga-scene-art-default"} style={figureStyle} />
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
        </defs>
        <path className="ga-scene-selection-shape ga-scene-liquid-cut" fill="var(--ga-nav-stage-base)" />
        <path className="ga-scene-liquid-body" fill="url(#ga-scene-panel-gradient)" />
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
