import { useEffect, useRef, useState } from "react";
import { loadPixelStyle, PIXEL_STYLE_EVENT } from "./pixelStylePreferences";
export default function VoxelLogo() {
 const video = useRef<HTMLVideoElement>(null);
 const [failed, setFailed] = useState(false);
 useEffect(() => {
  const media = matchMedia("(prefers-reduced-motion: reduce)");
  const sync = () => {
   const v = video.current;
   if (!v) return;
   if (!loadPixelStyle().animate || media.matches || document.visibilityState !== "visible") v.pause();
   else void v.play().catch(() => {});
  };
  const settled = () => { if (video.current) video.current.currentTime = 0; sync(); };
  sync(); window.addEventListener(PIXEL_STYLE_EVENT, sync); window.addEventListener("gameaccess:logo-settled", settled);
  document.addEventListener("visibilitychange", sync); media.addEventListener("change", sync);
  return () => { window.removeEventListener(PIXEL_STYLE_EVENT, sync); window.removeEventListener("gameaccess:logo-settled", settled); document.removeEventListener("visibilitychange", sync); media.removeEventListener("change", sync); video.current?.pause(); };
 }, [failed]);
 return <span className="ga-header-logo" aria-hidden="true">{failed
  ? <img src="/brand/logo-header-poster.png" alt="" />
  : <video ref={video} src="/brand/logo-header-loop.webm" poster="/brand/logo-header-poster.png" muted loop playsInline preload="auto" onError={() => setFailed(true)} />}</span>;
}
