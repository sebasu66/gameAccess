import { useRef, useState } from "react";

/**
 * A slider that says what it is doing: a big bubble with the value follows the
 * thumb while it is dragged. One value, or a from/to pair when `value` is a tuple.
 */
export default function FancySlider({ min, max, step = 1, value, onChange, format = String, label, ariaLabels }: {
  min: number; max: number; step?: number;
  value: number | [number, number];
  onChange: (value: number | [number, number]) => void;
  format?: (value: number) => string;
  label: string;
  ariaLabels?: [string, string];
}) {
  const range = Array.isArray(value);
  const low = range ? value[0] : min;
  const high = range ? value[1] : value;
  /** Which thumb is being dragged, so only its bubble is large. */
  const [active, setActive] = useState<0 | 1 | null>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  /** The bubble stays big while the thumb is held and a moment after letting go. */
  const timer = useRef<number | undefined>(undefined);
  const hold = (which: 0 | 1) => { window.clearTimeout(timer.current); setActive(which); };
  const release = () => { window.clearTimeout(timer.current); timer.current = window.setTimeout(() => setActive(null), 900); };
  const pct = (n: number) => ((n - min) / (max - min)) * 100;
  const set = (which: 0 | 1, next: number) => {
    if (!range) return onChange(next);
    onChange(which === 0 ? [Math.min(next, high), high] : [low, Math.max(next, low)]);
  };
  const thumb = (which: 0 | 1, current: number) => (
    <input key={which} type="range" min={min} max={max} step={step} value={current}
      aria-label={ariaLabels?.[which] ?? label} aria-valuetext={format(current)}
      // The thumb that sits on top has to be the one nearest the end it can still travel to.
      style={{ zIndex: which === 0 && low >= max - step ? 3 : 2 }}
      onChange={event => { hold(which); set(which, Number(event.target.value)); }}
      onPointerDown={() => hold(which)} onMouseDown={() => hold(which)} onTouchStart={() => hold(which)}
      onPointerUp={release} onMouseUp={release} onTouchEnd={release} onPointerCancel={release}
      onFocus={() => hold(which)} onKeyUp={release} onBlur={() => setActive(null)} />
  );
  const bubble = (which: 0 | 1, current: number) => (
    <span key={`${which}-${format(current)}`} className={"ga-fs-bubble" + (active === which ? " is-active" : "")} style={{ left: `${pct(current)}%` }} aria-hidden="true">
      {format(current)}
    </span>
  );
  return (
    <div className="ga-fs" ref={trackRef}>
      <div className="ga-fs-stage">
        <div className="ga-fs-rail"><div className="ga-fs-fill" style={{ left: `${pct(low)}%`, width: `${pct(high) - pct(low)}%` }} /></div>
        {range ? <>{bubble(0, low)}{bubble(1, high)}</> : bubble(1, high)}
        {range ? <>{thumb(0, low)}{thumb(1, high)}</> : thumb(1, high)}
      </div>
      <div className="ga-fs-ends"><span>{format(min)}</span><span>{format(max)}</span></div>
    </div>
  );
}
