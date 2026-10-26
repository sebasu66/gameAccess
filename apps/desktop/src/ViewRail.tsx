import { useEffect, useLayoutEffect, useRef } from "react";
import "@fontsource/archivo-black/400.css";
import { gsap, motionOk } from "./motion/gsap";
import { useI18n } from "./i18n";
import "./view-rail.css";

export type RailView = "catalog" | "library";

/**
 * The name of the current view, huge and vertical on the left edge (docs/GUI_DESIGN.md §4.16): CATALOGO in
 * orange or LIBRERIA in green, the longer one 110 % of the window height and both as thick, fading toward the center.
 * The letters are drawn as real screen pixels (drawPixelWord): a grid of 5 px cells, each one lit whole or not at all,
 * so the edges of the letters step like pixels seen up close. Changing view slides the old word up and the new one in
 * from below.
 */
/** Cell of the pixel grid and the square lit inside it (the rest is the gap between pixels). */
const CELL = 5, DOT = 4;

/**
 * Draws a word the way its span lays it out (vertical-rl, the letters turned a quarter clockwise) as pixels: a cell is
 * lit when at least half of its square falls inside the letters. A lit cell shows a faint full cell (the letter's
 * silhouette) and a bright square in it; colours run across the word like the CSS gradients they replace.
 */
function drawPixelWord(word: HTMLElement) {
  const canvas = word.querySelector("canvas"), text = word.querySelector<HTMLElement>(".text")?.textContent ?? "";
  if (!canvas) return;
  const w = Math.ceil(word.offsetWidth), h = Math.ceil(word.offsetHeight), size = parseFloat(word.style.fontSize) || 100;
  if (!w || !h) return;
  // The letters at one CSS pixel per canvas pixel, to measure how much of each cell they cover.
  const shape = document.createElement("canvas");
  shape.width = w; shape.height = h;
  const s = shape.getContext("2d", { willReadFrequently: true });
  if (!s) return;
  s.font = `400 ${size}px "Archivo Black", "Arial Black", sans-serif`;
  (s as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = `${size * .01}px`;
  s.textAlign = "center"; s.textBaseline = "alphabetic"; s.fillStyle = "#000";
  s.translate(w / 2, h / 2); s.rotate(Math.PI / 2);
  // The baseline where CSS puts it: line-height 1 centres the font's ascent + descent in a line box `size` wide,
  // whose top is on the right (the turned glyphs face right), i.e. at -w/2 in the turned frame.
  const metrics = s.measureText(text), ascent = metrics.fontBoundingBoxAscent, descent = metrics.fontBoundingBoxDescent;
  s.fillText(text, 0, -w / 2 + (size - ascent - descent) / 2 + ascent);
  const alpha = s.getImageData(0, 0, w, h).data;
  const covered = (x0: number, y0: number) => {
    let sum = 0, count = 0;
    for (let y = y0; y < Math.min(h, y0 + DOT); y++) for (let x = x0; x < Math.min(w, x0 + DOT); x++) { sum += alpha[(y * w + x) * 4 + 3]; count++; }
    return count > 0 && sum / count >= 128;
  };
  const ratio = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(w * ratio); canvas.height = Math.round(h * ratio);
  const c = canvas.getContext("2d");
  if (!c) return;
  c.scale(ratio, ratio);
  const css = getComputedStyle(word), color = (name: string) => css.getPropertyValue(name).trim();
  // As the CSS had it: right edge the light tone, toward the left the base (silhouette) or base then dark (squares).
  const silhouette = c.createLinearGradient(w, 0, 0, 0);
  silhouette.addColorStop(0, color("--rw-hi")); silhouette.addColorStop(1, color("--rw"));
  const dots = c.createLinearGradient(w, 0, 0, 0);
  dots.addColorStop(0, color("--rw-hi")); dots.addColorStop(.45, color("--rw")); dots.addColorStop(1, color("--rw-lo"));
  const lit: Array<[number, number]> = [];
  for (let y = 0; y < h; y += CELL) for (let x = 0; x < w; x += CELL) if (covered(x, y)) lit.push([x, y]);
  c.globalAlpha = .28; c.fillStyle = silhouette;
  for (const [x, y] of lit) c.fillRect(x, y, CELL, CELL);
  c.globalAlpha = 1; c.fillStyle = dots;
  for (const [x, y] of lit) c.fillRect(x, y, DOT, DOT);
}

export default function ViewRail({ view }: { view: RailView }) {
  const { t } = useI18n();
  const root = useRef<HTMLDivElement>(null);
  const shown = useRef<RailView>(view);
  const words: Record<RailView, string> = { catalog: t("railCatalog"), library: t("railLibrary") };

  // Both words use one size, so they are equally thick: the longer word (at the same size) is 110 % of the window
  // height and the other is a little shorter. The rail reserves the width they take.
  useLayoutEffect(() => {
    const size = () => {
      const host = root.current;
      if (!host) return;
      const words = [...host.querySelectorAll<HTMLElement>(".ga-rail-word")];
      const longest = Math.max(1, ...words.map(word => { word.style.fontSize = "100px"; return word.offsetHeight; }));
      let width = 0;
      for (const word of words) {
        word.style.fontSize = `${100 * window.innerHeight * 1.1 / longest}px`;
        width = Math.max(width, word.offsetWidth);
        drawPixelWord(word);
      }
      document.documentElement.style.setProperty("--ga-rail", `${Math.round(width * .92)}px`);
      clearance();
      host.querySelectorAll<HTMLElement>(".ga-rail-word").forEach(word => gsap.set(word, { yPercent: -50, rotation: 180, y: word.dataset.view === shown.current ? 0 : window.innerHeight * 1.3 }));
    };
    // The content is centred on the window, not beside the word; it only keeps clear of the word by as much as the
    // word reaches into the content area (none on wide windows). Measured, because side panels move the room.
    const clearance = () => {
      const host = root.current, room = document.querySelector<HTMLElement>(".library-room");
      if (!host || !room) return;
      const contentLeft = room.getBoundingClientRect().left + (parseFloat(getComputedStyle(room).paddingLeft) || 0);
      const clear = Math.max(0, Math.round(host.getBoundingClientRect().right - contentLeft));
      document.documentElement.style.setProperty("--ga-rail-clear", `${clear}px`);
    };
    size();
    void document.fonts?.ready.then(size);
    window.addEventListener("resize", size);
    const room = document.querySelector<HTMLElement>(".library-room");
    const observer = room && typeof ResizeObserver !== "undefined" ? new ResizeObserver(clearance) : null;
    if (room) observer?.observe(room);
    return () => {
      window.removeEventListener("resize", size);
      observer?.disconnect();
      document.documentElement.style.removeProperty("--ga-rail");
      document.documentElement.style.removeProperty("--ga-rail-clear");
    };
  }, [words.catalog, words.library]);

  useEffect(() => {
    const host = root.current;
    const previous = shown.current;
    if (!host || previous === view) return;
    shown.current = view;
    const out = host.querySelector<HTMLElement>(`.ga-rail-word[data-view="${previous}"]`);
    const into = host.querySelector<HTMLElement>(`.ga-rail-word[data-view="${view}"]`);
    const travel = window.innerHeight * 1.3 * (view === "library" ? 1 : -1);
    if (!motionOk()) { gsap.set(out, { y: travel }); gsap.set(into, { y: 0 }); return; }
    gsap.to(out, { y: -travel, duration: 1.1, ease: "expo.inOut", overwrite: "auto" });
    gsap.fromTo(into, { y: travel }, { y: 0, duration: 1.1, ease: "expo.inOut", overwrite: "auto", delay: .05 });
  }, [view]);

  return (
    <div ref={root} className="ga-view-rail" aria-hidden="true">
      {(Object.keys(words) as RailView[]).map(key => (
        <span key={key} className="ga-rail-word" data-view={key}><span className="text">{words[key]}</span><canvas /></span>
      ))}
    </div>
  );
}
