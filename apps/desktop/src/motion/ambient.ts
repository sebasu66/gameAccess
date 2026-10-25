/**
 * The background that takes the colours of the game under the pointer (from the approved demo). Only the cover's
 * palette is used, painted as a soft gradient (not the picture itself), so colourful covers stay subtle. Two tiny
 * canvases crossfade: the gradient is painted on the hidden canvas and only opacity animates, so the background
 * never flashes an empty layer nor recomputes a large blur every frame.
 */
import { gsap } from "./gsap";
import { paintPalette, paletteOf } from "./palette";

let layers: HTMLCanvasElement[] = [];
let timer = 0;
let lastSrc = "";
let waiting: HTMLImageElement | null = null;

export function registerAmbient(canvases: HTMLCanvasElement[]): () => void {
  layers = canvases;
  if (waiting) { const image = waiting; waiting = null; setAmbient(image); }
  return () => { if (layers === canvases) { layers = []; lastSrc = ""; } };
}

export function setAmbient(image: HTMLImageElement): void {
  if (!layers.length) { waiting = image; return; }
  window.clearTimeout(timer);
  timer = window.setTimeout(() => {
    const src = image.currentSrc || image.src;
    if (!src || src === lastSrc) return;
    lastSrc = src;
    void paletteOf(src).then(colors => {
      if (lastSrc !== src || !colors.length || !layers.length) return;
      const [a, b] = layers;
      const next = Number(gsap.getProperty(a, "opacity")) <= Number(gsap.getProperty(b, "opacity")) ? a : b, prev = next === a ? b : a;
      paintPalette(next, colors);
      gsap.killTweensOf(layers);
      gsap.to(next, { opacity: .6, duration: 1.2, ease: "power2.out" });
      gsap.to(prev, { opacity: 0, duration: 1.2, ease: "power2.out" });
    });
  }, 140);
}
