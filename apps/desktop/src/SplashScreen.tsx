import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "./i18n";
import { loadPixelStyle } from "./pixelStylePreferences";
import type { OpeningStage } from "./openingFlow";
import { LOGO_SETTLED_EVENT } from "./centralDialog/openingSettled";
import openingAudio from "../public/brand/opening-audio.json";
// The opening sound ends with silence; the closed gate never waits for it longer than this.
export const HOLD_MAX_MS = 900;
// The lock: its lines are drawn, then it turns a quarter to unlock; the gate opens once access is settled.
const DRAW_MS = 1100, TURN_MS = 950, OPEN_MS = 1300;
type Props = { stage: OpeningStage; onIntroReady: () => void; onDockStart: () => void; onDocked: () => void };

// The maker's emblem, engraved in the lock and filled with coloured glass: a G and an A that together make one circle (outer radius 138, inner 106).
// The A's leg is a straight band of constant width (32, the ring's own thickness) from the top of the circle to its
// bottom right, cut by the outer circle at both ends. The G is the ring up to the leg's left edge: both of its ends are
// cut along that same line, so G and A meet exactly. The A's bar, also the G's bar, ends on that line too. Unlocked,
// the A lights up in orange.
const EMBLEM_G = "M 97.0 98.2 A 138 138 0 1 1 0.0 -138.0 L 13.5 -105.1 A 106 106 0 1 0 83.5 65.3 Z";
const EMBLEM_A = "M 0.0 -138.0 A 138 138 0 0 1 36.6 -133.1 L 119.6 68.9 A 138 138 0 0 1 97.0 98.2 Z M -34 8 L 60.0 8 L 70.6 34 L -34 34 Z";
const BRAND = "GAME ACCESS";

/** The lock: a round plate fixed to the right leaf and lying over the seam, as a real cover would have it. Its rim is
 *  knurled; the maker's emblem and the brand are engraved in it. It turns a quarter to unlock (the padlock beside it
 *  goes out) and its A lights up; then it leaves with its leaf. */
function Lock() {
 return <svg className="gs-lock" viewBox="-230 -230 460 460" aria-hidden="true">
  <defs>
   <radialGradient id="gs-plate" cx="38%" cy="32%" r="80%"><stop offset="0" stopColor="#4a535a" /><stop offset=".55" stopColor="#262c31" /><stop offset="1" stopColor="#14181b" /></radialGradient>
   <linearGradient id="gs-rim" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#6d777e" /><stop offset=".5" stopColor="#2a3136" /><stop offset="1" stopColor="#0f1214" /></linearGradient>
   <path id="gs-brand-top" d="M -170 0 A 170 170 0 0 1 170 0" />
   {/* The plate is turned metal: fine concentric rings (a radial gradient repeated every 2.6 units), the frame's
       brushed steel faintly over it, and the two crossed sheens a lathe-turned disc throws. */}
   <clipPath id="gs-plate-clip"><circle r="200" /></clipPath>
   <radialGradient id="gs-spun" gradientUnits="userSpaceOnUse" cx="0" cy="0" r="2.6" spreadMethod="repeat"><stop offset="0" stopColor="#fff" stopOpacity=".05" /><stop offset=".5" stopColor="#000" stopOpacity=".09" /><stop offset="1" stopColor="#fff" stopOpacity=".05" /></radialGradient>
   <linearGradient id="gs-spun-sheen" gradientUnits="userSpaceOnUse" x1="-200" y1="-200" x2="200" y2="200"><stop offset="0" stopColor="#fff" stopOpacity="0" /><stop offset=".3" stopColor="#fff" stopOpacity=".1" /><stop offset=".5" stopColor="#fff" stopOpacity="0" /><stop offset=".72" stopColor="#fff" stopOpacity=".07" /><stop offset="1" stopColor="#fff" stopOpacity="0" /></linearGradient>
   {/* The letters are coloured glass set into the engraving: the G in the library's green, the A in the catalogue's
       orange (the colours of the big side words, view-rail.css), with a sheen and fine scratches on the glass only. */}
   <linearGradient id="gs-glass-g" gradientUnits="userSpaceOnUse" x1="-120" y1="-120" x2="110" y2="120"><stop offset="0" stopColor="#e8f9f0" /><stop offset=".42" stopColor="#a0d2b4" /><stop offset="1" stopColor="#3f7a5d" /></linearGradient>
   <linearGradient id="gs-glass-a" gradientUnits="userSpaceOnUse" x1="-20" y1="-140" x2="120" y2="100"><stop offset="0" stopColor="#ffcf9a" /><stop offset=".4" stopColor="#f57a1a" /><stop offset="1" stopColor="#a8490a" /></linearGradient>
   <linearGradient id="gs-glass-sheen" gradientUnits="userSpaceOnUse" x1="-140" y1="-140" x2="60" y2="60"><stop offset="0" stopColor="#fff" stopOpacity=".5" /><stop offset=".38" stopColor="#fff" stopOpacity=".1" /><stop offset=".52" stopColor="#fff" stopOpacity="0" /><stop offset="1" stopColor="#fff" stopOpacity=".06" /></linearGradient>
   <clipPath id="gs-letters"><path d={EMBLEM_G} /><path d={EMBLEM_A} /></clipPath>
   {/* The cavity: the glass sits below the plate, so it is shaded all round its edge (smaller inside than at the
       rim), more on the top left where the wall hides the light, and catches a faint light on the bottom right. */}
   <filter id="gs-inset" x="-20%" y="-20%" width="140%" height="140%">
    <feMorphology in="SourceAlpha" operator="erode" radius="2.5" result="inner" />
    <feGaussianBlur in="inner" stdDeviation="3" result="innerSoft" />
    <feComposite in="SourceAlpha" in2="innerSoft" operator="out" result="ring" />
    <feFlood floodColor="#000" floodOpacity=".5" /><feComposite in2="ring" operator="in" result="ringShade" />
    <feOffset in="SourceAlpha" dx="3" dy="3" result="moved" />
    <feGaussianBlur in="moved" stdDeviation="2.4" result="movedSoft" />
    <feComposite in="SourceAlpha" in2="movedSoft" operator="out" result="topLeft" />
    <feFlood floodColor="#000" floodOpacity=".6" /><feComposite in2="topLeft" operator="in" result="topLeftShade" />
    <feOffset in="SourceAlpha" dx="-2" dy="-2" result="back" />
    <feGaussianBlur in="back" stdDeviation="1.6" result="backSoft" />
    <feComposite in="SourceAlpha" in2="backSoft" operator="out" result="bottomRight" />
    <feFlood floodColor="#fff" floodOpacity=".28" /><feComposite in2="bottomRight" operator="in" result="bottomRightLight" />
    <feMerge><feMergeNode in="ringShade" /><feMergeNode in="topLeftShade" /><feMergeNode in="bottomRightLight" /></feMerge>
   </filter>
   {/* The rim: a thin raised edge round the letters, lit on the top left and in shade on the bottom right. */}
   <linearGradient id="gs-raise" gradientUnits="userSpaceOnUse" x1="-110" y1="-110" x2="110" y2="110"><stop offset="0" stopColor="#9aa4ab" /><stop offset=".5" stopColor="#4a5359" /><stop offset="1" stopColor="#0c0f11" /></linearGradient>
  </defs>
  <g className="gs-lock-turn">
   <circle className="gs-rim" r="214" />
   <g className="gs-knurl">{Array.from({ length: 120 }, (_, index) => <line key={index} x1="0" y1="-214" x2="0" y2="-203" transform={`rotate(${index * 3})`} />)}</g>
   <circle className="gs-plate" r="200" />
   <g className="gs-plate-metal" clipPath="url(#gs-plate-clip)">
    <image className="gs-plate-brush" href="/textures/brushed-steel.jpg" x="-200" y="-200" width="400" height="400" preserveAspectRatio="xMidYMid slice" />
    <circle r="200" fill="url(#gs-spun)" />
    <circle r="200" fill="url(#gs-spun-sheen)" />
    <circle r="200" fill="url(#gs-spun-sheen)" transform="rotate(90)" />
   </g>
   <circle className="gs-groove" r="158" />
   <circle className="gs-groove" r="190" />
   {/* Engraved in the plate, lit from the top left: each cut is dark, with a light lip on its lower right edge. */}
   <text className="gs-brand is-lip" transform="translate(1 1)"><textPath href="#gs-brand-top" startOffset="50%">{BRAND}</textPath></text>
   <text className="gs-brand"><textPath href="#gs-brand-top" startOffset="50%">{BRAND}</textPath></text>
   <g className="gs-emblem">
    <g className="gs-raise"><path d={EMBLEM_G} /><path d={EMBLEM_A} /></g>
    <g className="gs-lip" transform="translate(1.8 1.8)"><path d={EMBLEM_G} /><path d={EMBLEM_A} /></g>
    <path className="gs-cut" d={EMBLEM_G} />
    <path className="gs-cut is-a" d={EMBLEM_A} />
    {/* The glass in the cuts; the A's lights up when the lock is open. */}
    <path className="gs-glass" d={EMBLEM_G} fill="url(#gs-glass-g)" />
    <path className="gs-glass is-a" d={EMBLEM_A} fill="url(#gs-glass-a)" />
    {/* The cavity's shading, worked out on G and A together so their meeting line shows no edge. */}
    <g className="gs-cavity" filter="url(#gs-inset)"><path d={EMBLEM_G} /><path d={EMBLEM_A} /></g>
    <g className="gs-glass-top" clipPath="url(#gs-letters)">
     {/* Seba's scratch texture: light scratches on black; the screen blend makes the black transparent. */}
     <image className="gs-scratch" href="/textures/glass-scratches.jpg" x="-150" y="-150" width="300" height="300" preserveAspectRatio="xMidYMid slice" />
     <rect x="-160" y="-160" width="320" height="320" fill="url(#gs-glass-sheen)" />
    </g>
   </g>
  </g>
 </svg>;
}

/** The state of the cover, set into the left leaf beside the lock like a backlit logo: a small padlock lit from
 *  inside while the cover is locked. When the emblem has turned, its shackle springs open and its light goes out. */
function Padlock() {
 return <svg className="gs-padlock" viewBox="-20 -24 40 46" aria-hidden="true">
  <path className="gs-padlock-shackle" d="M -8 -2 V -9 A 8 8 0 0 1 8 -9 V -2" />
  <rect className="gs-padlock-body" x="-12" y="-3" width="24" height="20" rx="3" />
  <circle className="gs-padlock-hole" cy="5" r="2.4" />
 </svg>;
}

/** One half of the cover: brushed gunmetal like the frame, with its own framed border and a bevelled edge on the
 *  seam, recessed panels, vents, bolts and fine engraved lines. The right one carries the lock, lying over the seam. */
export function Leaf({ side }: { side: "left" | "right" }) {
 return <div className={`gs-leaf is-${side}`}>
  {/* Its frame: an engraved border all round, and a heavy bevelled edge where it meets the other leaf. */}
  <i className="gs-frame" /><i className="gs-edge" />
  {/* The pattern: two recessed panels with cut corners (faintly hatched), vent slots, engraved guide lines. */}
  <i className="gs-panel is-top" /><i className="gs-panel is-bottom" />
  <i className="gs-vents" />
  <i className="gs-leaf-engrave" />
  <i className="gs-bolt is-a" /><i className="gs-bolt is-b" /><i className="gs-bolt is-c" /><i className="gs-bolt is-d" />
  <i className="gs-hazard" />
  {side === "right" ? <div className="gs-leaf-lock"><Lock /></div> : <Padlock />}
 </div>;
}

/**
 * The opening: a metal cover, made like the device frame around it, closes the screen. On its seam lies a round lock
 * fixed to the right leaf, the maker's emblem (G·A) engraved in it; it turns a quarter to unlock and the backlit
 * padlock beside it goes out. Once access is settled, the cover opens on both sides like a gate, the lock leaving with its leaf, and the
 * app is there. The phases and callbacks are the opening flow's (ActivationGate): intro (drawn and unlocked), hold
 * (the opening sound), dock (the gate opens).
 */
export default function SplashScreen({ stage, onIntroReady, onDockStart, onDocked }: Props) {
 const { t } = useI18n();
 const [formed, setFormed] = useState(stage !== "intro");
 const [audioState, setAudioState] = useState("idle");
 const [opening, setOpening] = useState(false);
 const [landing, setLanding] = useState(false);
 const sound = useRef<HTMLAudioElement | null>(null);
 const started = useRef(false);
 const finished = useRef(false);
 const phase = !formed ? "intro" : stage === "intro" ? "hold" : "dock";
 const reduced = !loadPixelStyle().animate || matchMedia("(prefers-reduced-motion: reduce)").matches;
 const reducedRef = useRef(reduced);
 const finishDock = useCallback(() => {
  if (finished.current) return;
  finished.current = true;
  document.body.classList.remove("ga-splash-active");
  window.dispatchEvent(new Event(LOGO_SETTLED_EVENT));
  if (reducedRef.current) { onDocked(); return; }
  setLanding(true);
  window.setTimeout(onDocked, 260);
 }, [onDocked]);
 useEffect(() => {
  document.body.classList.add("ga-splash-active");
  return () => {
   document.body.classList.remove("ga-splash-active");
   const audio = sound.current;
   if (!audio) return;
   // Let the sound fade instead of cutting it when the opening ends.
   const fade = window.setInterval(() => { audio.volume = Math.max(0, audio.volume - .1); if (audio.volume <= .01) { audio.pause(); window.clearInterval(fade); } }, 40);
  };
 }, []);
 useEffect(() => {
  const src = openingAudio.src as string | null;
  if (!src) return;
  const audio = new Audio(src); audio.preload = "auto"; sound.current = audio;
  audio.onplaying = () => setAudioState("playing");
  audio.onended = () => setAudioState("ended");
  audio.onerror = () => setAudioState("error");
  // The sound starts with the drawing of the lock.
  if (!reduced) void audio.play().catch(() => setAudioState("blocked"));
  return () => { sound.current = null; };
 }, []); // eslint-disable-line react-hooks/exhaustive-deps
 useEffect(() => {
  if (phase === "intro") {
   // Drawn, then turned: the lock is open.
   const timer = window.setTimeout(() => setFormed(true), reduced ? 0 : DRAW_MS + TURN_MS + 250);
   return () => clearTimeout(timer);
  }
  if (phase === "hold") {
   // Keep the cover closed until the opening sound has finished (never longer than HOLD_MAX_MS).
   const audio = sound.current;
   const remaining = audioState === "playing" && audio && Number.isFinite(audio.duration) ? Math.max(0, audio.duration - audio.currentTime) * 1000 : 0;
   const timer = window.setTimeout(onIntroReady, reduced ? 80 : Math.min(HOLD_MAX_MS, Math.max(400, remaining)));
   return () => clearTimeout(timer);
  }
  if (started.current) return;
  started.current = true;
  onDockStart();
  if (reduced) { finishDock(); return; }
  // The gate opens; the app (fading in under it) is there when it is gone.
  setOpening(true);
  const timer = window.setTimeout(finishDock, OPEN_MS + 100);
  return () => clearTimeout(timer);
 }, [phase, reduced, audioState, onIntroReady, onDockStart, finishDock]);
 const cls = `gameaccess-splash gs-gate phase-${phase}${opening ? " is-opening" : ""}${landing ? " is-landing" : ""}${reduced ? " is-still" : ""}`;
 return <div className={cls} data-phase={phase} data-opening-audio={audioState} role="status" aria-label={t("splashStarting")}
  style={{ "--gs-draw": `${DRAW_MS}ms`, "--gs-turn": `${TURN_MS}ms`, "--gs-open": `${OPEN_MS}ms` } as React.CSSProperties}>
  <Leaf side="left" />
  <Leaf side="right" />
 </div>;
}
