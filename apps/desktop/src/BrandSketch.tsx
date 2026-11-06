import { useEffect, useId, useRef } from "react";
import { motionOk } from "./motion/gsap";
import { SKETCH_GLYPHS } from "./brandGlyphs";
import "./brand-sketch.css";

/**
 * GAME and ACCESS sketched letter by letter: the letters are barely there, a thin pencil line and a faint fill a shade
 * off the background, between guide lines like a sketch on a wall.
 *
 * The timing is the brand scene's turn (tools/brand/animation-studio.html, clip "loop": 858 frames at 30 fps), whose
 * yaw is -π/4·(1 - cos(2π·t/T)): the logo reads as G at t = 0 and as A at t = T/2; cos(2π·t/T) says how close the turn
 * is to each letter. The word keeps its own clock on that loop (useSketchClock).
 */
const LOOP_SECONDS = 858 / 30;
type Word = "game" | "access";

/**
 * How far each word is drawn (0..1) at time `t` of the loop. The word builds up while the logo turns, not only at the
 * instant the letter forms: `turn` goes from 0 (G) to 1 (A) and back with the yaw. Leaving the G, GAME is erased over
 * the first half of the turn; CCESS is drawn over the second half and is complete when the A is; then the other way.
 * The turn is slow near each letter, so each word stays whole for about 6 s around it.
 */
export function sketchProgress(t: number): Record<Word, number> {
  const turn = (1 - Math.cos(2 * Math.PI * (t % LOOP_SECONDS) / LOOP_SECONDS)) / 2;
  const ramp = (x: number, from: number, to: number) => Math.min(1, Math.max(0, (x - from) / (to - from)));
  return { game: 1 - ramp(turn, .12, .48), access: ramp(turn, .52, .88) };
}

// Guide lines, as when marking a wall to line drawings up: two verticals beside the column and one horizontal at each
// row boundary, wider than the letters, all fading into nothing past the drawing.
const CELL = 64, OVERHANG_X = 46, OVERHANG_Y = 30;

function SketchWord({ word, letters }: { word: Word; letters: readonly string[] }) {
  const id = useId().replace(/:/g, "");
  const height = letters.length * CELL;
  return (
    <svg className="ga-sketch-word" data-word={word} style={{ "--n": letters.length } as React.CSSProperties} viewBox={`0 0 60 ${height}`} aria-hidden="true">
      <defs>
        <linearGradient id={`${id}-h`} gradientUnits="userSpaceOnUse" x1={-OVERHANG_X} y1="0" x2={60 + OVERHANG_X} y2="0">
          <stop offset="0" stopColor="#fff" stopOpacity="0" /><stop offset=".32" stopColor="#fff" stopOpacity="1" />
          <stop offset=".68" stopColor="#fff" stopOpacity="1" /><stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <linearGradient id={`${id}-v`} gradientUnits="userSpaceOnUse" x1="0" y1={-OVERHANG_Y} x2="0" y2={height + OVERHANG_Y}>
          <stop offset="0" stopColor="#fff" stopOpacity="0" /><stop offset=".12" stopColor="#fff" stopOpacity="1" />
          <stop offset=".88" stopColor="#fff" stopOpacity="1" /><stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <g className="ga-sketch-guides">
        {[4, 56].map(x => <line key={x} x1={x} y1={-OVERHANG_Y} x2={x} y2={height + OVERHANG_Y} stroke={`url(#${id}-v)`} />)}
        {Array.from({ length: letters.length + 1 }, (_, row) => <line key={row} x1={-OVERHANG_X} y1={row * CELL} x2={60 + OVERHANG_X} y2={row * CELL} stroke={`url(#${id}-h)`} />)}
      </g>
      {letters.map((letter, index) => (
        <g key={index} className="ga-sketch-cell" style={{ "--i": index } as React.CSSProperties} transform={`translate(0 ${index * CELL})`}>
          <path className="ga-sketch-ghost" d={SKETCH_GLYPHS[letter]} pathLength={1} transform="translate(1.2 1)" />
          <path className="ga-sketch-letter" d={SKETCH_GLYPHS[letter]} pathLength={1} />
        </g>
      ))}
    </svg>
  );
}

/** Longest step the clock takes at once: after a pause (minimised, asleep, a game in front) it goes on, never jumps. */
const MAX_STEP_SECONDS = .1;
/** How often a stopped clock is checked: if anything stopped the frames while the window is shown, they start again. */
const WATCHDOG_MS = 2000;

/**
 * The word's own loop clock (it used to follow the corner logo's video, and froze for good when the window came back
 * and that video did not play again). It runs while the window is shown, waits while it is hidden, minimised or the
 * computer sleeps, and goes on from where it was; sets --game / --access on `host` every frame. With "reduce motion"
 * GAME stays drawn.
 */
function useSketchClock(host: React.RefObject<HTMLElement>) {
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    if (!motionOk()) { element.style.setProperty("--game", "1"); element.style.setProperty("--access", "0"); return; }
    let frame = 0, last = 0, elapsed = 0;
    const paint = (now: number) => {
      frame = 0;
      if (last) elapsed += Math.min(Math.max(0, now - last) / 1000, MAX_STEP_SECONDS);
      last = now;
      const progress = sketchProgress(elapsed);
      element.style.setProperty("--game", progress.game.toFixed(3));
      element.style.setProperty("--access", progress.access.toFixed(3));
      if (document.hidden) last = 0;
      else frame = window.requestAnimationFrame(paint);
    };
    const start = () => { if (!frame && !document.hidden) { last = 0; frame = window.requestAnimationFrame(paint); } };
    start();
    const watchdog = window.setInterval(start, WATCHDOG_MS);
    window.addEventListener("focus", start);
    window.addEventListener("pageshow", start);
    document.addEventListener("visibilitychange", start);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearInterval(watchdog);
      window.removeEventListener("focus", start);
      window.removeEventListener("pageshow", start);
      document.removeEventListener("visibilitychange", start);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
}

/**
 * The whole word in sketched letters, one under the other: G A M E, then A C C E S S, built and erased letter by
 * letter on the brand turn's timing (sketchProgress), without end.
 */
export function BrandWord() {
  const host = useRef<HTMLSpanElement>(null);
  useSketchClock(host);
  return (
    <span ref={host} className="ga-brand-word" role="img" aria-label="GameAccess">
      <SketchWord word="game" letters={["G", "A", "M", "E"]} />
      <SketchWord word="access" letters={["A", "C", "C", "E", "S", "S"]} />
    </span>
  );
}
