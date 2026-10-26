import { useEffect, useRef } from "react";
import { motionOk } from "../motion/gsap";

const COLS = 32, ROWS = 15, FPS_MS = 50, BITS = 14;
type State = "working" | "done" | "failed";

/**
 * The game's own picture freezing, drawn straight on the grid's background (no panel, no colour of its own): the
 * part already frozen is made of ice cubes, each one a pixel of the picture under frosted glass (a faint white fill
 * and a fine light edge, like the idle search field), and the rest of the picture stays faint. A few cubes travel:
 * towards the frozen part while freezing, away from it while thawing. One canvas, about 20 frames a second, and only
 * while the work runs (a still frame otherwise, and with reduced motion).
 */
export default function FrostImage({ src, thaw, percent, state }: { src: string; thaw: boolean; percent: number; state: State }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const live = useRef({ thaw, percent, state });
  live.current = { thaw, percent, state };
  const redraw = useRef<() => void>(() => undefined);

  useEffect(() => {
    const element = canvas.current;
    const ctx = element?.getContext("2d");
    if (!element || !ctx) return;
    const image = new Image();
    const tiny = document.createElement("canvas");
    tiny.width = COLS; tiny.height = ROWS;
    let ready = false, frame = 0, last = 0;
    const size = () => {
      const ratio = window.devicePixelRatio || 1;
      element.width = Math.round(element.clientWidth * ratio);
      element.height = Math.round(element.clientHeight * ratio);
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    };
    const draw = (now: number) => {
      if (!ready) return;
      const { thaw: melting, percent: share, state: phase } = live.current;
      const width = element.clientWidth, height = element.clientHeight, cell = width / COLS, row = height / ROWS;
      // Columns left of the edge are ice: freezing grows them from the left, thawing gives the picture back from the right.
      const frozen = Math.max(0, Math.min(1, melting ? 1 - share / 100 : share / 100));
      const edge = frozen * COLS;
      ctx.clearRect(0, 0, width, height);
      ctx.imageSmoothingEnabled = true;
      ctx.globalAlpha = 0.22;
      const from = Math.floor(edge) * cell;
      if (from < width) ctx.drawImage(image, (from / width) * image.naturalWidth, 0, image.naturalWidth * (1 - from / width), image.naturalHeight, from, 0, width - from, height);
      ctx.imageSmoothingEnabled = false;
      const cube = (col: number, line: number, x: number, y: number, scale: number, alpha: number) => {
        const w = (cell - 2) * scale, h = (row - 2) * scale, left = x + (cell - w) / 2, top = y + (row - h) / 2;
        ctx.globalAlpha = 0.42 * alpha;
        ctx.drawImage(tiny, col, line, 1, 1, left, top, w, h);
        ctx.globalAlpha = alpha;
        ctx.fillStyle = "rgba(255,255,255,.07)";
        ctx.fillRect(left, top, w, h);
        ctx.strokeStyle = "rgba(255,255,255,.18)";
        ctx.strokeRect(left + .5, top + .5, w - 1, h - 1);
      };
      for (let col = 0; col < Math.ceil(edge); col += 1) {
        // The edge column sets its cubes one by one.
        const partial = Math.min(1, edge - col);
        for (let line = 0; line < ROWS; line += 1) {
          if (partial < 1 && ((line * 7 + col * 3) % ROWS) / ROWS > partial) continue;
          cube(col, line, col * cell, line * row, 1, 1);
        }
      }
      if (phase === "working" && motionOk()) {
        // Travelling cubes: from the picture into the ice (freezing), or out of it (thawing).
        const span = width - edge * cell;
        for (let index = 0; index < BITS; index += 1) {
          const t = ((now / 1000) * 0.45 + index / BITS) % 1;
          const line = (index * 5) % ROWS;
          const travel = melting ? t : 1 - t;
          const x = edge * cell + travel * Math.max(span, cell * 4) * 0.7;
          const col = Math.min(COLS - 1, Math.floor(x / cell));
          cube(col, line, x, line * row, 0.55 + 0.45 * (melting ? 1 - t : t), Math.sin(t * Math.PI) * 0.9);
        }
      }
      ctx.globalAlpha = 1;
    };
    const loop = (now: number) => {
      frame = 0;
      if (now - last >= FPS_MS || live.current.state !== "working") { last = now; draw(now); }
      if (live.current.state === "working" && motionOk()) frame = requestAnimationFrame(loop);
    };
    redraw.current = () => { if (!frame) frame = requestAnimationFrame(loop); };
    image.onload = () => {
      tiny.getContext("2d")?.drawImage(image, 0, 0, COLS, ROWS);
      ready = true;
      size();
      redraw.current();
    };
    image.src = src;
    const resize = new ResizeObserver(() => { size(); redraw.current(); });
    resize.observe(element);
    return () => { if (frame) cancelAnimationFrame(frame); resize.disconnect(); redraw.current = () => undefined; };
  }, [src]);

  // A new share or state: one more frame (the loop keeps going by itself while working).
  useEffect(() => { redraw.current(); }, [percent, state, thaw]);

  return <canvas ref={canvas} className="lm-frost" aria-hidden="true" />;
}
