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

/** The round lock in the middle of the cover: a ring of ticks, and the monogram split by the seam, the G on its left
 *  half and the A on its right half, drawn in fine orange lines. Each half of the gate carries the whole lock, clipped
 *  to its side, so the lock splits with the gate. */
function Lock() {
 return <svg className="gs-lock" viewBox="-220 -220 440 440" aria-hidden="true">
  <circle className="gs-lock-plate" r="196" />
  {/* The seam of the gate runs through the lock: a dark groove with a light edge. */}
  <line className="gs-lock-seam" x1="0" y1="-196" x2="0" y2="196" />
  <line className="gs-lock-seam is-light" x1="1.5" y1="-196" x2="1.5" y2="196" />
  <g className="gs-lock-ticks">
   {Array.from({ length: 72 }, (_, index) => {
    const long = index % 6 === 0, angle = index * 5;
    return <line key={index} x1="0" y1={-208} x2="0" y2={long ? -192 : -200} transform={`rotate(${angle})`} className={long ? "is-long" : undefined} />;
   })}
  </g>
  <circle className="gs-lock-ring gs-draw" r="168" pathLength={100} />
  <circle className="gs-lock-ring is-thin gs-draw" r="150" pathLength={100} />
  <g className="gs-lock-turn">
   {/* G: an arc open towards the seam, its bar turning in; A: two legs and a bar. */}
   <path className="gs-glyph gs-draw" pathLength={100} d="M -34 -54 A 64 64 0 1 0 -34 54 L -34 8 L -64 8" />
   <path className="gs-glyph gs-draw" pathLength={100} d="M 30 66 L 76 -66 L 122 66 M 47 20 L 105 20" transform="translate(-6 0)" />
   <line className="gs-lock-key gs-draw" pathLength={100} x1="0" y1="-150" x2="0" y2="-118" />
   <line className="gs-lock-key gs-draw" pathLength={100} x1="0" y1="118" x2="0" y2="150" />
  </g>
  {/* The latches crossing the seam: they slide away once the lock has turned. */}
  <rect className="gs-latch is-top" x="-34" y="-186" width="68" height="10" rx="2" />
  <rect className="gs-latch is-bottom" x="-34" y="176" width="68" height="10" rx="2" />
 </svg>;
}

/** One half of the cover: brushed gunmetal like the frame, a few bolts, corner marks and fine engraved lines, and the
 *  lock clipped to that half. */
function Leaf({ side }: { side: "left" | "right" }) {
 return <div className={`gs-leaf is-${side}`}>
  <i className="gs-leaf-engrave" />
  <i className="gs-bolt is-a" /><i className="gs-bolt is-b" /><i className="gs-bolt is-c" /><i className="gs-bolt is-d" />
  <i className="gs-corner is-top" /><i className="gs-corner is-bottom" />
  <i className="gs-hazard" />
  <div className="gs-leaf-lock"><Lock /></div>
 </div>;
}

/**
 * The opening: a metal cover, made like the device frame around it, closes the screen. In its middle a round lock is
 * drawn in fine lines, a G and an A split by the seam; it turns a quarter to unlock (G left, A right) and its latches
 * slide away. Once access is settled, the cover opens on both sides like a gate, the lock splitting with it, and the
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
