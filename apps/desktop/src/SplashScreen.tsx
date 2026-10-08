import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "./i18n";
import { loadPixelStyle } from "./pixelStylePreferences";
export default function SplashScreen({ onComplete }: { onComplete: () => void }) {
 const { t } = useI18n();
 const [phase, setPhase] = useState<"intro" | "dock">("intro");
 const video = useRef<HTMLVideoElement>(null);
 const finished = useRef(false);
 const finish = useCallback(() => {
  if (finished.current) return;
  finished.current = true;
  document.body.classList.remove("ga-splash-active");
  window.dispatchEvent(new Event("gameaccess:logo-settled"));
  onComplete();
 }, [onComplete]);
 useEffect(() => {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches || !loadPixelStyle().animate) { finish(); return; }
  document.body.classList.add("ga-splash-active");
  // A decoding/network failure must never trap the user behind the splash.
  const timeout = window.setTimeout(finish, 15000);
  return () => { clearTimeout(timeout); document.body.classList.remove("ga-splash-active"); };
 }, [finish]);
 useEffect(() => {
  const v = video.current;
  if (v) void v.play().catch(finish);
 }, [phase, finish]);
 const dock = () => {
  const v = video.current;
  if (!v || phase !== "dock") return;
  const target = document.querySelector(".ga-header-logo")?.getBoundingClientRect();
  if (!target) { finish(); return; }
  const scale = innerWidth / 1920;
  const x = target.x + target.width / 2 - 64 * scale;
  const y = target.y + target.height / 2 - 54 * scale;
  const initialY = (innerHeight - innerWidth * 1080 / 1920) / 2;
  v.animate([{ transform: `translate(0px,${initialY}px)` }, { transform: `translate(${x}px,${y}px)` }], { duration: 3000, easing: "cubic-bezier(.22,.68,.18,1)", fill: "forwards" });
 };
 return <div className="gameaccess-splash" role="status" aria-label={t("splashStarting")}>
  <video key={phase} ref={video} className="gameaccess-splash-film" src={phase === "intro" ? "/brand/logo-intro.webm" : "/brand/logo-to-header.webm"}
   muted playsInline autoPlay preload="auto" onPlaying={dock} onError={finish} onEnded={() => phase === "intro" ? setPhase("dock") : finish()} aria-hidden="true" />
 </div>;
}
