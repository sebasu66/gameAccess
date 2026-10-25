import { useLayoutEffect, useRef } from "react";
import { BrandWord } from "./BrandSketch";
import "./brand-wall.css";

/** Width / height of the word (a 60 x 64 cell, six rows: ACCESS). */
const ASPECT = 60 / (64 * 6);
/** Clear of the animated logo in the top-right corner (top 24 px, 56 px tall) and of the bottom tabs. */
const TOP = 98, GAP = 12;
/** From the bezel to the word's box: none, so the letters (a few pixels inside their cell) almost touch the bezel. */
const RIGHT_MARGIN = 0;
/** Below this height the column is too narrow for the word to read as a wall drawing: it is not shown. */
const MIN_HEIGHT = .4;

/**
 * GAME / ACCESS sketched huge in the empty column right of the content (with the device frame):
 * the drawing the tab's LCD had, letter by letter with the animated logo's turn, but on the screen, against the
 * column's right side, each word centred on the window's height (ACCESS fills its six rows, GAME sits one row lower;
 * brand-wall.css), about the size of the view word on the left, and barely there: thin, semi-transparent lines.
 * Measured, because the column's width depends on the window and on the side panels; it shrinks to fit and hides
 * when there is no room.
 */
export default function BrandWall({ video }: { video: string }) {
  const host = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    let frame = 0;
    const place = () => {
      frame = 0;
      const element = host.current, column = document.querySelector<HTMLElement>(".library-room-catalog");
      if (!element) return;
      if (!column) { element.dataset.fits = "false"; return; }
      const box = column.getBoundingClientRect();
      const contentRight = box.right - (parseFloat(getComputedStyle(column).paddingRight) || 0);
      const css = getComputedStyle(document.documentElement);
      const frameRight = parseFloat(css.getPropertyValue("--ga-frame-right")) || 0;
      const frameBottom = parseFloat(css.getPropertyValue("--ga-frame-bottom")) || 0;
      const deskRight = parseFloat(css.getPropertyValue("--ga-desk-right")) || 0;
      // The screen starts under the app's title bar (desktop window only).
      const offset = parseFloat(css.getPropertyValue("--ga-frame-offset")) || 0;
      // The empty column: from the content's right edge to the bezel, or to an open right-hand side panel (which is as
      // wide as --ga-desk-right plus the bezel's reach).
      const right = window.innerWidth - frameRight - deskRight;
      const space = right - contentRight;
      // Centred on the window: as tall as fits between the corner logo and the bottom tabs on both halves.
      const half = (window.innerHeight - offset) / 2;
      const tall = 2 * Math.min(half - TOP, half - frameBottom - GAP);
      const height = Math.min(tall, space * .8 / ASPECT);
      const fits = height >= window.innerHeight * MIN_HEIGHT;
      element.dataset.fits = String(fits);
      if (!fits) return;
      element.style.setProperty("--wall-height", `${Math.round(height)}px`);
      const width = height * ASPECT;
      element.style.setProperty("--wall-left", `${Math.round(Math.max(contentRight + (space - width) / 2, right - RIGHT_MARGIN - width))}px`);
      element.style.setProperty("--wall-top", `${Math.round(offset + half - height / 2)}px`);
    };
    const schedule = () => { if (!frame) frame = window.requestAnimationFrame(place); };
    window.addEventListener("resize", schedule);
    // The column appears after the first render and changes with the view and with side panels.
    const resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(schedule);
    let watched: Element | null = null;
    const watch = () => {
      const column = document.querySelector(".library-room-catalog");
      if (column && column !== watched) { if (watched) resize?.unobserve(watched); watched = column; resize?.observe(column); }
      schedule();
    };
    const mutations = new MutationObserver(watch);
    mutations.observe(document.querySelector(".app-shell") ?? document.body, { childList: true, subtree: true });
    watch();
    return () => { window.removeEventListener("resize", schedule); resize?.disconnect(); mutations.disconnect(); window.cancelAnimationFrame(frame); };
  }, []);
  return <div ref={host} className="ga-brand-wall" data-fits="false" aria-hidden="true"><BrandWord video={video} /></div>;
}
