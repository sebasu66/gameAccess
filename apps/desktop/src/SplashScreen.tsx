import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "./i18n";
import { loadPixelStyle } from "./pixelStylePreferences";
import type { OpeningStage } from "./openingFlow";
import openingAudio from "../public/brand/opening-audio.json";
type Props = { stage: OpeningStage; onIntroReady: () => void; onDockStart: () => void; onDocked: () => void };
export default function SplashScreen({ stage, onIntroReady, onDockStart, onDocked }: Props) {
 const { t } = useI18n();
 const [formed, setFormed] = useState(stage !== "intro");
 const [audioState, setAudioState] = useState("idle");
 const video = useRef<HTMLVideoElement>(null);
 const sound = useRef<HTMLAudioElement | null>(null);
 const started = useRef(false);
 const finished = useRef(false);
 const phase = stage === "docking" ? "dock" : formed ? "hold" : "intro";
 const reduced = !loadPixelStyle().animate || matchMedia("(prefers-reduced-motion: reduce)").matches;
 const finishDock = useCallback(() => {
  if (finished.current) return;
  finished.current = true;
  document.body.classList.remove("ga-splash-active");
  window.dispatchEvent(new Event("gameaccess:logo-settled"));
  onDocked();
 }, [onDocked]);
 useEffect(() => {
  document.body.classList.add("ga-splash-active");
  return () => { document.body.classList.remove("ga-splash-active"); sound.current?.pause(); };
 }, []);
 useEffect(() => {
  const src = openingAudio.src as string | null;
  // The supplied opening sound follows formation playback, including replay.
  if (!src) return;
  const audio = new Audio(src); audio.preload = "auto"; sound.current = audio;
  audio.onplaying = () => setAudioState("playing");
  audio.onended = () => setAudioState("ended");
  audio.onerror = () => setAudioState("error");
  return () => { audio.pause(); sound.current = null; };
 }, []);
 useEffect(() => {
  if (phase === "intro") {
   if (reduced) { setFormed(true); return; }
   const timer = window.setTimeout(() => setFormed(true), 12000);
   return () => clearTimeout(timer);
  }
  if (phase === "hold") {
   const timer = window.setTimeout(onIntroReady, reduced ? 80 : 700);
   return () => clearTimeout(timer);
  }
  if (reduced) { onDockStart(); finishDock(); return; }
  // Decoder fallback advances the animation only; the gate still requires approval.
  const timer = window.setTimeout(finishDock, 8000);
  return () => clearTimeout(timer);
 }, [phase, reduced, onIntroReady, onDockStart, finishDock]);
 const play = () => {
  if (phase === "intro") { if (!reduced && sound.current) { sound.current.currentTime = 0; void sound.current.play().catch(() => setAudioState("blocked")); } return; }
  if (phase !== "dock" || started.current) return;
  started.current = true;
  const v = video.current;
  if (!v) return;
  const target = Array.from(document.querySelectorAll(".ga-header-logo")).map(e => e.getBoundingClientRect()).find(rect => rect.width > 0);
  const scale = innerWidth / 1920;
  const frame = Math.min(96,Math.max(60,innerWidth * .0421875));
  const chrome = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--window-chrome-height")) || 34;
  const cx = target ? target.x + target.width / 2 : 16 + frame * .3;
  const cy = target ? target.y + target.height / 2 : chrome + 16 + frame * .3;
  const x = cx - 64 * scale, y = cy - 54 * scale;
  const initialY = (innerHeight - innerWidth * 1080 / 1920) / 2;
  const ratio = frame / (81 * scale);
  // The transparent film's individual voxels travel independently; its final
  // frame is aligned to the visible header logo at every window size.
  v.animate([
   { transform: `translate(0px,${initialY}px) scale(1)` },
   { transform: `translate(${cx - 64 * scale * ratio}px,${cy - 54 * scale * ratio}px) scale(${ratio})` },
  ], { duration: 3000, easing: "cubic-bezier(.22,.68,.18,1)", fill: "forwards" });
  onDockStart();
 };
 return <div className={`gameaccess-splash phase-${phase}`} data-phase={phase} data-opening-audio={audioState} role="status" aria-label={t("splashStarting")}>
  {phase === "hold" ? <img className="gameaccess-splash-film" src="/brand/logo-intro-hold.png" alt="" />
   : <video key={phase} ref={video} className="gameaccess-splash-film" src={phase === "intro" ? "/brand/logo-intro.webm" : "/brand/logo-to-header.webm"}
    muted playsInline autoPlay preload="auto" onPlaying={play} onError={() => phase === "intro" ? setFormed(true) : finishDock()}
    onEnded={() => phase === "intro" ? setFormed(true) : finishDock()} aria-hidden="true" />}
 </div>;
}
