import { useEffect } from "react";
import { startPixelEffects } from "./referencePixelEffects";
export default function PixelAppearance() {
 useEffect(() => {
  document.body.classList.add("ga-pixel-style");
  const stop = startPixelEffects();
  return () => { stop(); document.body.classList.remove("ga-pixel-style"); };
 }, []);
 return null;
}
