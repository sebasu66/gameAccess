import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import "./brand-tab.css";

/**
 * A static tab that comes out of the window's right edge and frames what it holds (the sketched logo): a darker
 * panel whose left side has cut corners, drawn with thin technical lines (outline, an inner line on the left, orange
 * accents at the cuts and a notch, ticks along the edge) and two rails along the wall above and below it, as if the
 * tab were mounted on a track. The lines are drawn for the tab's real size in pixels, so the cuts never stretch.
 */
const CUT = 16, INSET = 5, RAIL = 120;

export default function BrandTab({ children }: { children: ReactNode }) {
  const host = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const element = host.current;
    if (!element) return;
    const measure = () => setSize({ width: Math.round(element.offsetWidth), height: Math.round(element.offsetHeight) });
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(element);
    return () => observer?.disconnect();
  }, []);

  const { width: w, height: h } = size;
  const outline = `M${w} .5 H${CUT} L.5 ${CUT} V${h - CUT} L${CUT} ${h - .5} H${w}`;
  const inner = `M${CUT + 26} ${INSET} H${CUT + 2} L${INSET} ${CUT + 2} V${h - CUT - 2} L${CUT + 2} ${h - INSET} H${CUT + 26}`;
  const ticks = Array.from({ length: Math.max(0, Math.floor((h - 2 * CUT - 24) / 18)) }, (_, i) => CUT + 12 + i * 18);
  return (
    <div ref={host} className="ga-brand-tab">
      {w > 0 ? (
        <svg className="ga-brand-tab-frame" width={w} height={h + 2 * RAIL} viewBox={`0 ${-RAIL} ${w} ${h + 2 * RAIL}`} aria-hidden="true">
          <defs>
            <linearGradient id="ga-brand-tab-rail-up" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stopColor="#fff" stopOpacity=".35" /><stop offset="1" stopColor="#fff" stopOpacity="0" /></linearGradient>
            <linearGradient id="ga-brand-tab-rail-down" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#fff" stopOpacity=".35" /><stop offset="1" stopColor="#fff" stopOpacity="0" /></linearGradient>
            <pattern id="ga-brand-tab-grid" width="12" height="12" patternUnits="userSpaceOnUse"><path d="M12 0H0V12" fill="none" stroke="#fff" strokeWidth=".5" /></pattern>
          </defs>
          {/* The track on the wall, above and below the tab. */}
          <rect className="ga-brand-tab-rail" x={w - 3} y={-RAIL} width="1" height={RAIL} fill="url(#ga-brand-tab-rail-up)" />
          <rect className="ga-brand-tab-rail" x={w - 3} y={h} width="1" height={RAIL} fill="url(#ga-brand-tab-rail-down)" />
          <path className="ga-brand-tab-panel" d={`${outline} Z`} />
          <path className="ga-brand-tab-grid" d={`${outline} Z`} fill="url(#ga-brand-tab-grid)" />
          <path className="ga-brand-tab-outline" d={outline} />
          <path className="ga-brand-tab-inner" d={inner} />
          {/* Orange accents on the cuts and a notch halfway down the edge. */}
          <path className="ga-brand-tab-accent" d={`M${CUT + 10} .5 H${CUT} L.5 ${CUT} V${CUT + 10} M.5 ${h - CUT - 10} V${h - CUT} L${CUT} ${h - .5} H${CUT + 10}`} />
          <path className="ga-brand-tab-notch" d={`M.5 ${h / 2 - 14} H4 V${h / 2 + 14} H.5`} />
          {ticks.map(y => <line key={y} className="ga-brand-tab-tick" x1={INSET + 3} y1={y} x2={INSET + (y % 54 === (CUT + 12) % 54 ? 9 : 6)} y2={y} />)}
        </svg>
      ) : null}
      <div className="ga-brand-tab-content">{children}</div>
    </div>
  );
}
