import { useEffect, useRef, useState } from "react";
export default function VoxelLogo() {
 const video = useRef<HTMLVideoElement>(null);
 const [failed, setFailed] = useState(false);
 useEffect(() => {
  const resume = () => {
   const current = video.current;
   if (current) void current.play().catch(() => {});
  };
  resume();
  window.addEventListener("focus", resume);
  document.addEventListener("visibilitychange", resume);
  return () => {
   window.removeEventListener("focus", resume);
   document.removeEventListener("visibilitychange", resume);
   video.current?.pause();
  };
 }, [failed]);
 return <span className="ga-brand-lockup" aria-hidden="true">
  <span className="ga-header-logo">{failed
   ? <img src="/brand/logo-header-poster.png" alt="" />
   : <video ref={video} src="/brand/logo-header-loop.webm" poster="/brand/logo-header-poster.png" autoPlay muted loop playsInline preload="auto" onError={() => setFailed(true)} />}</span>
  <span className="ga-header-wordmark"><span>Game</span><span>Access</span></span>
 </span>;
}
