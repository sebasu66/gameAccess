import { useEffect, useRef, useState } from "react";
import { gsap, motionOk } from "./motion/gsap";
import { registerAmbient } from "./motion/ambient";
import { loadPixelStyle, PIXEL_STYLE_EVENT } from "./pixelStylePreferences";
import "./ambient.css";

/**
 * The approved demo's background (docs/TAREA-interfaz-nueva.md): dark grey, softly tinted with the colour of the
 * game under the pointer, a fine grain and an orange glow that follows the mouse. The animated pixel field stays as
 * an option in Settings → Appearance; while it is on, this background is not drawn.
 */
export default function AmbientBackground() {
  const [field, setField] = useState(() => loadPixelStyle().field);
  const host = useRef<HTMLDivElement>(null);
  const glow = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const sync = () => setField(loadPixelStyle().field);
    window.addEventListener(PIXEL_STYLE_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => { window.removeEventListener(PIXEL_STYLE_EVENT, sync); window.removeEventListener("storage", sync); };
  }, []);
  useEffect(() => {
    if (field || !host.current) return;
    const unregister = registerAmbient([...host.current.querySelectorAll("canvas")]);
    const light = glow.current;
    if (!light) return unregister;
    const x = gsap.quickTo(light, "x", { duration: .8, ease: "power3" }), y = gsap.quickTo(light, "y", { duration: .8, ease: "power3" });
    const move = (event: PointerEvent) => { if (!motionOk()) return; x(event.clientX); y(event.clientY); gsap.to(light, { opacity: 1, duration: .6, overwrite: "auto" }); };
    window.addEventListener("pointermove", move);
    return () => { unregister(); window.removeEventListener("pointermove", move); };
  }, [field]);
  if (field) return null;
  return <>
    <div ref={host} className="ga-ambient" aria-hidden="true"><canvas width={64} height={36} /><canvas width={64} height={36} /></div>
    <div className="ga-grain" aria-hidden="true" />
    <div ref={glow} className="ga-cursor-glow" aria-hidden="true" />
  </>;
}
