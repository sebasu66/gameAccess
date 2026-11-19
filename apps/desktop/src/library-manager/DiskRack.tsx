/**
 * The rack that holds the disks in Manager › Space (Seba's piece, 2026-11-18; docs/GUI_DESIGN.md §4.45). The disks are
 * not floating one under the other any more: each one sits in a bay of a rack.
 *
 * The bay is Seba's own drawing (`hdd/rack-bay.webp`), used as it is: the tray with its two engraved bands, the notch
 * at the open left end and, on the right, the column that closes the piece with a window near its top and the green
 * cable running down it. Nothing sits on top of the piece, so the bays stack flush into one rack. The bay keeps the
 * drawing's proportions (`--ga-rack-aspect`), so nothing in it is ever stretched, and everything Game Access puts on
 * the piece is placed by the fractions measured on the drawing: the disk in the free area, the two switches in the
 * first band, what the disk holds in the second, and the disk's own colour lit in the window.
 *
 * While a game moves between two disks, dots of green light travel the painted cable in the direction the data goes
 * (still with reduced motion). There are always at least three shelves: with one or two disks the rack keeps going
 * with empty bays that fade out downwards, so the column never ends in an awkward hole.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { gsap, motionOk } from "../motion/gsap";
import "./rack.css";

/** Always this many shelves, real disks and empty bays together. */
export const RACK_SHELVES = 3;
/** The move going on: the data goes from one disk to the other. */
export type RackTransfer = { from: string; to: string } | null;

export default function DiskRack({ letters, transfer, ghosts = 0, children }: {
  /** The disks in the rack, in the order they are drawn (to find the two ends of a move). */ letters: string[];
  transfer?: RackTransfer; ghosts?: number; children: ReactNode;
}) {
  const host = useRef<HTMLDivElement>(null);
  const flow = useRef<SVGPathElement>(null);
  const [width, setWidth] = useState(0);

  // Every bay is the same piece at the same proportions, so the rack's width is all the drawing needs.
  const measure = useCallback(() => {
    const rack = host.current;
    if (rack) setWidth(Math.round(rack.getBoundingClientRect().width));
  }, []);
  useLayoutEffect(() => {
    const rack = host.current;
    if (!rack || typeof ResizeObserver === "undefined") { measure(); return undefined; }
    const watch = new ResizeObserver(() => measure());
    watch.observe(rack);
    return () => watch.disconnect();
  }, [measure]);

  const style = host.current ? getComputedStyle(host.current) : null;
  const size = (name: string, fallback: number) => {
    const value = Number.parseFloat(style?.getPropertyValue(name) ?? "");
    return Number.isFinite(value) ? value : fallback;
  };
  // Where the piece has its cable, as fractions of the drawing.
  const ratio = size("--ga-rack-ratio", 2.74), wireX = size("--ga-rack-wire-x", .956);
  const wireY = size("--ga-rack-wire-y", .487), branchX = size("--ga-rack-branch-x", .847);
  const bay = width / ratio;
  const shelves = letters.length + Math.max(0, ghosts);

  // The stretch of cable between the two disks of the move: along their branches and down the column.
  const first = transfer ? letters.indexOf(transfer.from) : -1;
  const last = transfer ? letters.indexOf(transfer.to) : -1;
  const way = width && first >= 0 && last >= 0 && first !== last
    ? `M ${branchX * width} ${(first + wireY) * bay} H ${wireX * width} V ${(last + wireY) * bay} H ${branchX * width}`
    : "";

  // The dots travel from the disk the game leaves towards the disk that takes it (the way the path is drawn).
  useEffect(() => {
    const line = flow.current;
    if (!line || !way) return undefined;
    if (!motionOk()) { line.style.strokeDashoffset = "0"; return undefined; }
    const step = Number.parseFloat(getComputedStyle(line).getPropertyValue("--ga-rack-dot-step")) || 24;
    const tween = gsap.fromTo(line, { strokeDashoffset: 0 }, { strokeDashoffset: -step * 6, duration: 2.4, ease: "none", repeat: -1 });
    return () => { tween.kill(); };
  }, [way]);

  return (
    <div ref={host} className="lm-rack" style={{ "--ga-rack-fade": `${Math.max(0, ghosts) * bay}px` } as CSSProperties}>
      {children}
      {Array.from({ length: Math.max(0, ghosts) }, (_, index) => <div key={`ghost-${index}`} className="lm-bay is-ghost" aria-hidden="true" />)}
      {way ? (
        <svg className="lm-rack-flow-art" width={width} height={shelves * bay} viewBox={`0 0 ${width} ${shelves * bay}`} aria-hidden="true" focusable="false">
          <path ref={flow} className="lm-rack-flow" d={way} />
        </svg>
      ) : null}
    </div>
  );
}
