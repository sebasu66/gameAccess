import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "./i18n";
import { loadPixelStyle } from "./pixelStylePreferences";
import type { OpeningStage } from "./openingFlow";
import openingAudio from "../public/brand/opening-audio.json";
// The opening sound ends with silence; the logo never waits for it longer than this.
export const HOLD_MAX_MS = 900;
type Props = { stage: OpeningStage; onIntroReady: () => void; onDockStart: () => void; onDocked: () => void };
/** The formed logo in the 1920x1080 hold frame: its visible glyph box and the glyph box of the header logo frame (84x84). */
const HOLD_GLYPH = { cx: 960, cy: 540.5, height: 499 };
const HEADER_GLYPH = { height: 48, frame: 84 };
const COMPACT_MS = 1100;
/** Where the header logo sits: centred at the top, below the window bar. */
function headerLogoTarget() {
 const frame = Math.min(96, Math.max(60, innerWidth * .0421875));
 const chrome = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--window-chrome-height")) || 34;
 return { cx: innerWidth / 2, cy: chrome - 8 + frame / 2, glyph: frame * HEADER_GLYPH.height / HEADER_GLYPH.frame };
}
export default function SplashScreen({ stage, onIntroReady, onDockStart, onDocked }: Props) {
 const { t } = useI18n();
 const [formed, setFormed] = useState(stage !== "intro");
 const [audioState, setAudioState] = useState("idle");
 const [landing, setLanding] = useState(false);
 const [compactDone, setCompactDone] = useState(false);
 const video = useRef<HTMLVideoElement>(null);
 const hold = useRef<HTMLImageElement>(null);
 const sound = useRef<HTMLAudioElement | null>(null);
 const compacting = useRef<Animation | null>(null);
 const finished = useRef(false);
 /** Mounted already past the opening (an open session expired): the logo is simply up there, no flight. */
 const startedCompact = useRef(stage === "validation" || stage === "docking");
 const instant = useRef(startedCompact.current);
 const compactStage = stage === "validation" || stage === "docking";
 const phase = compactStage ? "compact" : formed ? "hold" : "intro";
 const reduced = !loadPixelStyle().animate || matchMedia("(prefers-reduced-motion: reduce)").matches;
 const reducedRef = useRef(reduced);
 const finishDock = useCallback(() => {
  if (finished.current) return;
  finished.current = true;
  // The header logo appears right away while the picture fades out over it: no pop.
  document.body.classList.remove("ga-splash-active");
  window.dispatchEvent(new Event("gameaccess:logo-settled"));
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
  // The supplied opening sound follows formation playback, including replay.
  if (!src) return;
  const audio = new Audio(src); audio.preload = "auto"; sound.current = audio;
  audio.onplaying = () => setAudioState("playing");
  audio.onended = () => setAudioState("ended");
  audio.onerror = () => setAudioState("error");
  return () => { sound.current = null; };
 }, []);
 useEffect(() => {
  if (phase === "intro") {
   // A replay starts over from the big logo.
   compacting.current?.cancel(); compacting.current = null;
   startedCompact.current = false; instant.current = false; finished.current = false;
   setCompactDone(false); setLanding(false);
   if (reduced) { setFormed(true); return; }
   const timer = window.setTimeout(() => setFormed(true), 12000);
   return () => clearTimeout(timer);
  }
  if (phase === "hold") {
   // Keep the formed logo large until the complete opening sound finishes.
   const audio = sound.current;
   const remaining = audioState === "playing" && audio && Number.isFinite(audio.duration) ? Math.max(0, audio.duration - audio.currentTime) * 1000 : 0;
   const timer = window.setTimeout(onIntroReady, reduced ? 80 : Math.min(HOLD_MAX_MS, Math.max(400, remaining)));
   return () => clearTimeout(timer);
  }
 }, [phase, reduced, audioState, onIntroReady]);
 // The big logo shrinks and flies to its place at the top centre; the access panel (or the app) follows it in one movement.
 useEffect(() => {
  if (phase !== "compact" || compacting.current) return;
  const img = hold.current;
  if (!img) return;
  const s = innerWidth / 1920;
  const initialY = (innerHeight - innerWidth * 1080 / 1920) / 2;
  const target = headerLogoTarget();
  const ratio = target.glyph / (HOLD_GLYPH.height * s);
  const end = `translate(${target.cx - ratio * HOLD_GLYPH.cx * s}px,${target.cy - ratio * HOLD_GLYPH.cy * s}px) scale(${ratio})`;
  const duration = reducedRef.current || instant.current ? 0 : COMPACT_MS;
  const animation = img.animate([{ transform: `translate(0px,${initialY}px) scale(1)` }, { transform: end }],
   { duration, easing: "cubic-bezier(.5,.02,.18,1)", fill: "forwards" });
  compacting.current = animation;
  startedCompact.current = true;
  const done = () => setCompactDone(true);
  animation.onfinish = done;
  if (duration === 0) done();
 }, [phase]);
 // Once approved and tucked away at the top, the application takes over.
 useEffect(() => {
  if (stage !== "docking" || !compactDone) return;
  onDockStart();
  const timer = window.setTimeout(finishDock, reducedRef.current ? 0 : 350);
  return () => clearTimeout(timer);
 }, [stage, compactDone, onDockStart, finishDock]);
 const play = () => {
  if (phase === "intro" && !reduced && sound.current) { sound.current.currentTime = 0; void sound.current.play().catch(() => setAudioState("blocked")); }
 };
 const cls = `gameaccess-splash phase-${phase}${landing ? " is-landing" : ""}`;
 // Every layer stays mounted in turn so the picture never goes blank between films.
 return <div className={cls} data-phase={phase} data-opening-audio={audioState} role="status" aria-label={t("splashStarting")}>
  <img ref={hold} className={`gameaccess-splash-film splash-hold${phase !== "intro" ? " is-on" : ""}`} src="/brand/logo-intro-hold.png" alt="" />
  {phase === "intro" ? <video key="intro" ref={video} className="gameaccess-splash-film splash-intro" src="/brand/logo-intro.webm"
    muted playsInline autoPlay preload="auto" onPlaying={play} onError={() => setFormed(true)} onEnded={() => setFormed(true)} aria-hidden="true" /> : null}
 </div>;
}
