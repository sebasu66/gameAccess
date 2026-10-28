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

// The maker's emblem, engraved in the lock: a G and an A that together make one circle. The G is a thick ring open at
// the top right; the A uses its top left as its left side, closes the circle with a straight right leg from the top
// to the G's end, and its bar is also the G's bar. Unlocked, the A lights up in orange.
const EMBLEM_G = "M 108.7 85 A 138 138 0 1 1 0 -138 L 0 -106 A 106 106 0 1 0 83.5 65.3 Z";
const EMBLEM_A = "M 0 -138 L 33.4 -133.9 L 108.7 85 L 83.5 65.3 Z M -34 8 L 70 8 L 78 34 L -34 34 Z";
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
  </defs>
  <g className="gs-lock-turn">
   <circle className="gs-rim" r="214" />
   <g className="gs-knurl">{Array.from({ length: 120 }, (_, index) => <line key={index} x1="0" y1="-214" x2="0" y2="-203" transform={`rotate(${index * 3})`} />)}</g>
   <circle className="gs-plate" r="200" />
   <circle className="gs-groove" r="158" />
   <circle className="gs-groove" r="190" />
   {/* Engraved in the plate, lit from the top left: each cut is dark, with a light lip on its lower right edge. */}
   <text className="gs-brand is-lip" transform="translate(1 1)"><textPath href="#gs-brand-top" startOffset="50%">{BRAND}</textPath></text>
   <text className="gs-brand"><textPath href="#gs-brand-top" startOffset="50%">{BRAND}</textPath></text>
   <g className="gs-emblem">
    <g className="gs-lip" transform="translate(1.8 1.8)"><path d={EMBLEM_G} /><path d={EMBLEM_A} /></g>
    <path className="gs-cut" d={EMBLEM_G} />
    <path className="gs-cut is-a" d={EMBLEM_A} />
   </g>
   <circle className="gs-hub" r="9" />
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
