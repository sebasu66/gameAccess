import { useEffect, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import BrandWall from "./BrandWall";
import { FRAME, frameFillPath, frameInnerPath, frameOuterPath, tabAround, tabMerge, type FrameMetrics, type FrameTab } from "./frameGeometry";
import "./device-frame.css";

/**
 * The app as the screen of a device: a thin bezel around the window (below the app's own title bar, when there is
 * one) with a double line and cut corners, and tabs that come out of it where controls live on the edge: the status
 * and the footer buttons at the bottom, and a thin one at the middle of the top edge with GAME ACCESS lit in it.
 * Everything else is the screen under the bezel: the new-games banner, the big
 * view word on the left and, in the empty column on the right, the word
 * GAME / ACCESS sketched huge (BrandWall).
 *
 * Two layers over the screen: the metal body (with its shadow on the screen) and the engraved lines; the controls
 * mounted on it sit above both, and neither layer takes the pointer. Geometry in frameGeometry.ts.
 */
/** Always on; `?deviceFrame=0` turns it off (development). */
export function deviceFrameEnabled(): boolean {
  if (typeof window === "undefined") return false;
  const params = new URLSearchParams(window.location.search);
  return params.get("deviceFrame") !== "0";
}

/** Height of the app's own title bar (the desktop window has no system one); 0 when it is not shown (browser). */
const titleBarHeight = () => rectOf(".window-chrome")?.bottom ?? 0;

type Rect = { left: number; top: number; right: number; bottom: number } | null;
const rectOf = (selector: string): Rect => {
  const element = document.querySelector<HTMLElement>(selector);
  // Not offsetParent: it is always null for fixed elements, shown or not.
  if (!element || getComputedStyle(element).display === "none") return null;
  const r = element.getBoundingClientRect();
  return r.width > 0 && r.height > 0 ? { left: r.left, top: r.top, right: r.right, bottom: r.bottom } : null;
};

/**
 * Orange accents engraved in the metal, never on its edge: a mark parallel to each corner cut of the frame, inside the
 * band, and one parallel to each cut corner of a tab, a few pixels inside the tab.
 */
function accentPath(m: FrameMetrics, tabs: FrameTab[]): string {
  const { width: W, height: H, inset: I, corner: K, cut: C } = m, L = 12;
  // Inside the band, halfway between the bezel's outer line (5 px out, frameOuterPath) and the screen.
  const b = 2.5;
  // A bottom corner taken in by a tab has no cut of its own left to mark.
  const merged = tabs.map(tab => tabMerge(m, tab));
  const parts = [
    `M${I - b} ${I + K + L} V${I + K - b * .4} L${I + K - b * .4} ${I - b} H${I + K + L}`,
    `M${W - I - K - L} ${I - b} H${W - I - K + b * .4} L${W - I + b} ${I + K - b * .4} V${I + K + L}`,
  ];
  if (!merged.some(side => side.right)) parts.push(`M${W - I + b} ${H - I - K - L} V${H - I - K + b * .4} L${W - I - K + b * .4} ${H - I + b} H${W - I - K - L}`);
  if (!merged.some(side => side.left)) parts.push(`M${I + K + L} ${H - I + b} H${I + K - b * .4} L${I - b} ${H - I - K + b * .4} V${H - I - K - L}`);
  // Inside a tab: shifted into its metal (away from the screen) by `t`.
  const t = 5;
  for (const tab of tabs) {
    if (tab.depth < C * 2) continue;
    const d = tab.depth;
    if (tab.edge === "right") {
      const x = W - I - d;
      parts.push(`M${x + C + L + t} ${tab.from + t} H${x + C + t * .6} L${x + t} ${tab.from + C + t * .6} V${tab.from + C + L + t}`,
        `M${x + t} ${tab.to - C - L - t} V${tab.to - C - t * .6} L${x + C + t * .6} ${tab.to - t} H${x + C + L + t}`);
    }
    if (tab.edge === "bottom") {
      const y = H - I - d, side = tabMerge(m, tab);
      if (!side.left) parts.push(`M${tab.from + t} ${y + C + L + t} V${y + C + t * .6} L${tab.from + C + t * .6} ${y + t} H${tab.from + C + L + t}`);
      if (!side.right) parts.push(`M${tab.to - C - L - t} ${y + t} H${tab.to - C - t * .6} L${tab.to - t} ${y + C + t * .6} V${y + C + L + t}`);
    }
  }
  return parts.join(" ");
}

/** Short ticks between the two lines along the top and bottom, near the corners, like a scale on a bezel. */
function ticksPath(m: FrameMetrics): string {
  const { width: W, height: H, inset: I, corner: K } = m, parts: string[] = [];
  for (let i = 0; i < 6; i++) {
    const x = I + K + 30 + i * 9, len = i % 3 === 0 ? 5 : 3;
    parts.push(`M${x} ${I - 1} v${-len}`, `M${W - x} ${I - 1} v${-len}`, `M${x} ${H - I + 1} v${len}`, `M${W - x} ${H - I + 1} v${len}`);
  }
  return parts.join(" ");
}

export default function DeviceFrame() {
  const fill = useRef<SVGPathElement>(null);
  const shadow = useRef<SVGPathElement>(null);
  const sheen = useRef<SVGPathElement>(null);
  const steel = useRef<SVGPathElement>(null);
  const lipDark = useRef<SVGPathElement>(null);
  const lipLight = useRef<SVGPathElement>(null);
  const outer = useRef<SVGPathElement>(null);
  const inner = useRef<SVGPathElement>(null);
  const accents = useRef<SVGPathElement>(null);
  const ticks = useRef<SVGPathElement>(null);
  const layers = useRef<SVGSVGElement[]>([]);
  const tabs = useRef<FrameTab[]>([]);

  useEffect(() => {
    document.body.classList.add("ga-device-frame");
    return () => document.body.classList.remove("ga-device-frame");
  }, []);

  useLayoutEffect(() => {
    let frame = 0;
    // The screen starts under the title bar: the frame's coordinates are measured from there.
    let offset = 0;
    const metrics = (): FrameMetrics => ({ width: window.innerWidth, height: window.innerHeight - offset, ...FRAME });
    const below = (rect: Rect): Rect => rect && { ...rect, top: rect.top - offset, bottom: rect.bottom - offset };
    const paint = () => {
      const m = metrics();
      for (const svg of layers.current) svg.setAttribute("viewBox", `0 0 ${m.width} ${m.height}`);
      const body = frameFillPath(m, tabs.current), edge = frameInnerPath(m, tabs.current);
      for (const path of [fill, steel, sheen, shadow]) path.current?.setAttribute("d", body);
      for (const path of [lipDark, lipLight]) path.current?.setAttribute("d", edge);
      outer.current?.setAttribute("d", frameOuterPath(m));
      inner.current?.setAttribute("d", edge);
      accents.current?.setAttribute("d", accentPath(m, tabs.current));
      ticks.current?.setAttribute("d", ticksPath(m));
    };
    const measure = () => {
      frame = 0;
      offset = Math.round(titleBarHeight());
      const m = metrics();
      tabs.current = [
        tabAround("top", below(rectOf(".ga-frame-name")), m, 5),
        tabAround("bottom", below(rectOf(".ga-footer-left")), m, 10),
        tabAround("bottom", below(rectOf(".ga-dock")), m, 10),
      ].filter((tab): tab is FrameTab => Boolean(tab));
      // How far the bezel reaches into the window on each side (the band, plus its tabs): side panels sit inside it.
      const reach = (edge: FrameTab["edge"]) => m.inset + Math.max(0, ...tabs.current.filter(tab => tab.edge === edge).map(tab => tab.depth));
      const root = document.documentElement.style;
      root.setProperty("--ga-frame-offset", `${offset}px`);
      root.setProperty("--ga-frame-top", `${m.inset}px`);
      root.setProperty("--ga-frame-left", `${m.inset}px`);
      root.setProperty("--ga-frame-right", `${Math.round(reach("right"))}px`);
      root.setProperty("--ga-frame-bottom", `${Math.round(reach("bottom"))}px`);
      paint();
      // Elements can move by transform, which no observer reports: while anything moved since the last measure,
      // measure again next frame, for at most 1.5 s, then rest.
      const key = tabs.current.map(tab => `${Math.round(tab.from)},${Math.round(tab.to)},${Math.round(tab.depth)}`).join("|");
      const now = performance.now();
      if (key !== lastKey) { if (!settling) settleStart = now; settling = true; lastKey = key; }
      else settling = false;
      if (settling && now - settleStart < 1500) schedule();
    };
    let lastKey = "", settling = false, settleStart = 0;
    const schedule = () => { if (!frame) frame = window.requestAnimationFrame(measure); };
    window.addEventListener("resize", schedule);
    // The footer controls can mount after the frame and change with the view (the library adds a button): every
    // measure observes the elements present now; DOM changes are coalesced to one measure per frame.
    const resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(schedule);
    const watched = new Set<Element>();
    const watch = () => {
      for (const selector of [".ga-footer-left", ".ga-dock", ".window-chrome"]) {
        const element = document.querySelector(selector);
        if (element && !watched.has(element)) { watched.add(element); resize?.observe(element); }
      }
    };
    const mutations = new MutationObserver(() => { watch(); schedule(); });
    const shell = document.querySelector(".app-shell");
    if (shell) mutations.observe(shell, { childList: true, subtree: true });
    watch();
    measure();
    return () => {
      window.removeEventListener("resize", schedule); resize?.disconnect(); mutations.disconnect(); window.cancelAnimationFrame(frame);
      for (const name of ["--ga-frame-offset", "--ga-frame-top", "--ga-frame-left", "--ga-frame-right", "--ga-frame-bottom"]) document.documentElement.style.removeProperty(name);
    };
  }, []);

  const keep = (svg: SVGSVGElement | null) => { if (svg && !layers.current.includes(svg)) layers.current.push(svg); };
  return (
    <>
      {/* The frame's shadow on the screen, on its own layer just under the gate's leaves (z-index 510): the leaves are
          part of the frame, at its level, so the shadow falls on the screen but never on them. */}
      {createPortal(
        <svg ref={keep} className="ga-frame-layer ga-frame-shadow" aria-hidden="true">
          <path ref={shadow} fillRule="evenodd" fill="#1b2024" />
        </svg>,
        document.body,
      )}
      {createPortal(
        <svg ref={keep} className="ga-frame-layer ga-frame-back" aria-hidden="true">
          <defs>
            {/* Gunmetal: lighter toward the top and bottom of the device, darker at its middle, with a diagonal sheen and a
                real brushed-steel texture (ambientCG Metal009, CC0) blended into it. */}
            <linearGradient id="ga-frame-metal" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#353c42" /><stop offset=".08" stopColor="#23292e" /><stop offset=".5" stopColor="#1b2024" />
              <stop offset=".92" stopColor="#22282d" /><stop offset="1" stopColor="#30373d" />
            </linearGradient>
            <linearGradient id="ga-frame-sheen" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#fff" stopOpacity=".07" /><stop offset=".35" stopColor="#fff" stopOpacity="0" />
              <stop offset=".62" stopColor="#fff" stopOpacity=".045" /><stop offset="1" stopColor="#fff" stopOpacity="0" />
            </linearGradient>
            <pattern id="ga-frame-steel" width="512" height="512" patternUnits="userSpaceOnUse">
              <image href="/textures/brushed-steel.jpg" width="512" height="512" preserveAspectRatio="none" />
            </pattern>
          </defs>
          <path ref={fill} className="ga-frame-fill" fillRule="evenodd" fill="url(#ga-frame-metal)" />
          <path ref={steel} className="ga-frame-fill ga-frame-steel" fillRule="evenodd" fill="url(#ga-frame-steel)" />
          <path ref={sheen} className="ga-frame-fill" fillRule="evenodd" fill="url(#ga-frame-sheen)" />
          {/* The lip where the metal meets the screen: a dark groove and a thin bright bevel on the metal side. */}
          <path ref={lipDark} className="ga-frame-lip-dark" />
          <path ref={lipLight} className="ga-frame-lip-light" />
        </svg>,
        document.body,
      )}
      {createPortal(
        <svg ref={keep} className="ga-frame-layer ga-frame-lines" aria-hidden="true">
          <path ref={outer} className="ga-frame-outer" />
          <path ref={inner} className="ga-frame-inner" />
          <path ref={ticks} className="ga-frame-ticks" />
          <path ref={accents} className="ga-frame-accent" />
        </svg>,
        document.body,
      )}
      {/* The device's name, lit in a thin tab at the middle of the top edge. */}
      {createPortal(<span className="ga-frame-name" aria-hidden="true">GAME ACCESS</span>, document.body)}
      <BrandWall />
    </>
  );
}
