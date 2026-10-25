import { useEffect, useId, useRef, useState } from "react";
import { motionOk } from "./motion/gsap";
import { SKETCH_GLYPHS } from "./brandGlyphs";
import "./brand-sketch.css";

/**
 * The voxel logo with the rest of each word sketched under it, letter under letter: while the cubes read as G the
 * column shows A M E (GAME), while they read as A it shows C C E S S (ACCESS). The letters are barely there: a thin
 * pencil line and a faint fill a shade off the background, between guide lines like a sketch on a wall.
 *
 * Timed by the video itself, not by a timer: the loop is the brand scene's turn (tools/brand/animation-studio.html,
 * clip "loop": 858 frames at 30 fps), whose yaw is -π/4·(1 - cos(2π·t/T)). The cubes read as G at t = 0 (yaw 0°) and
 * as A at t = T/2 (yaw -90°); cos(2π·t/T) says how close the turn is to each letter.
 */
const LOOP_SECONDS = 858 / 30;
const WORDS = { game: ["A", "M", "E"], access: ["C", "C", "E", "S", "S"] } as const;
type Word = keyof typeof WORDS;

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

/**
 * Follows a loop clock (the animated logo's video time) and sets --game / --access on `host` every frame; with
 * "reduce motion" GAME stays drawn.
 */
function useSketchClock(host: React.RefObject<HTMLElement>, clock: () => number | null, deps: unknown[]) {
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    if (!motionOk()) { element.style.setProperty("--game", "1"); element.style.setProperty("--access", "0"); return; }
    let frame = 0;
    const paint = () => {
      const t = clock();
      if (t !== null) {
        const progress = sketchProgress(t);
        element.style.setProperty("--game", progress.game.toFixed(3));
        element.style.setProperty("--access", progress.access.toFixed(3));
      }
      frame = window.requestAnimationFrame(paint);
    };
    frame = window.requestAnimationFrame(paint);
    return () => window.cancelAnimationFrame(frame);
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
}

/** The animated voxel logo alone (the G/A that turns), kept playing when the window comes back. */
export function BrandLogoVideo({ className }: { className?: string }) {
  const video = useRef<HTMLVideoElement>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const resume = () => { void video.current?.play().catch(() => {}); };
    resume();
    window.addEventListener("focus", resume);
    document.addEventListener("visibilitychange", resume);
    return () => { window.removeEventListener("focus", resume); document.removeEventListener("visibilitychange", resume); };
  }, [failed]);
  return <span className={className} aria-hidden="true">{failed
    ? <img src="/brand/logo-header-poster.png" alt="" />
    : <video ref={video} src="/brand/logo-header-loop.webm" poster="/brand/logo-header-poster.png" autoPlay muted loop playsInline preload="auto" onError={() => setFailed(true)} />}</span>;
}

/**
 * The whole word in sketched letters, one under the other: G A M E while the animated logo reads as G, A C C E S S
 * while it reads as A, built and erased letter by letter as it turns. `video` is where the animated logo plays (its
 * time drives the word); the logo itself is shown elsewhere.
 */
export function BrandWord({ video }: { video: string }) {
  const host = useRef<HTMLSpanElement>(null);
  useSketchClock(host, () => document.querySelector<HTMLVideoElement>(video)?.currentTime ?? null, [video]);
  return (
    <span ref={host} className="ga-brand-word" role="img" aria-label="GameAccess">
      <SketchWord word="game" letters={["G", "A", "M", "E"]} />
      <SketchWord word="access" letters={["A", "C", "C", "E", "S", "S"]} />
    </span>
  );
}

export default function BrandSketch() {
  const video = useRef<HTMLVideoElement>(null);
  const column = useRef<HTMLSpanElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const host = column.current;
    let frame = 0;
    const paint = () => {
      const current = video.current;
      if (host && current) {
        const progress = sketchProgress(current.currentTime);
        host.style.setProperty("--game", progress.game.toFixed(3));
        host.style.setProperty("--access", progress.access.toFixed(3));
      }
      frame = window.requestAnimationFrame(paint);
    };
    const resume = () => { void video.current?.play().catch(() => {}); };
    resume();
    if (motionOk()) frame = window.requestAnimationFrame(paint);
    else if (host) { host.style.setProperty("--game", "1"); host.style.setProperty("--access", "0"); }
    window.addEventListener("focus", resume);
    document.addEventListener("visibilitychange", resume);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("focus", resume);
      document.removeEventListener("visibilitychange", resume);
    };
  }, [failed]);

  return (
    <span ref={column} className="ga-brand-sketch" aria-label="GameAccess" role="img">
      <span className="ga-brand-sketch-logo">{failed
        ? <img src="/brand/logo-header-poster.png" alt="" />
        : <video ref={video} src="/brand/logo-header-loop.webm" poster="/brand/logo-header-poster.png" autoPlay muted loop playsInline preload="auto" onError={() => setFailed(true)} />}</span>
      <span className="ga-brand-sketch-words">
        <SketchWord word="game" letters={WORDS.game} />
        <SketchWord word="access" letters={WORDS.access} />
      </span>
    </span>
  );
}
