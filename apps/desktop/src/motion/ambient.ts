/**
 * The background that takes the colour of the game under the pointer (from the approved demo). Two tiny canvases
 * crossfade: the image is already decoded (it is the card's own cover), it is drawn on the hidden canvas and only
 * opacity animates, so the background never flashes an empty layer nor recomputes a large blur every frame.
 */
import { gsap } from "./gsap";

let layers: HTMLCanvasElement[] = [];
let timer = 0;
let lastSrc = "";

export function registerAmbient(canvases: HTMLCanvasElement[]): () => void {
  layers = canvases;
  return () => { if (layers === canvases) { layers = []; lastSrc = ""; } };
}

export function setAmbient(image: HTMLImageElement): void {
  if (!layers.length) return;
  window.clearTimeout(timer);
  timer = window.setTimeout(() => {
    const src = image.currentSrc || image.src;
    if (!src || src === lastSrc || !image.complete || !image.naturalWidth) return;
    lastSrc = src;
    const [a, b] = layers;
    const next = Number(gsap.getProperty(a, "opacity")) <= Number(gsap.getProperty(b, "opacity")) ? a : b, prev = next === a ? b : a;
    try { next.getContext("2d")?.drawImage(image, 0, 0, next.width, next.height); } catch { return; }
    gsap.killTweensOf(layers);
    gsap.to(next, { opacity: .55, duration: 1.2, ease: "power2.out" });
    gsap.to(prev, { opacity: 0, duration: 1.2, ease: "power2.out" });
  }, 140);
}
