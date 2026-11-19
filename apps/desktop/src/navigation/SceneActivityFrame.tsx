import { useLayoutEffect, useRef, useState } from "react";

/** Flat frame: the icon lobe, top edge, full corner and right ribbon share one continuous silhouette. */
export default function SceneActivityFrame() {
  const ref = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ width: 300, height: 800 });
  useLayoutEffect(() => {
    const svg = ref.current;
    if (!svg) return;
    const measure = () => {
      const { width, height } = svg.getBoundingClientRect();
      if (width > 0 && height > 0) setSize(current => current.width === width && current.height === height ? current : { width, height });
    };
    const observer = new ResizeObserver(measure);
    observer.observe(svg);
    measure();
    return () => observer.disconnect();
  }, []);
  const { width: w, height: h } = size;
  // The 42px lobe is centered at the same inset as the pulse icon in the scrolling content.
  const path = `M 37 16 C 55 16 53 2 76 2 H ${w - 36} Q ${w - 2} 2 ${w - 2} 36 V ${h - 36} Q ${w - 2} ${h - 2} ${w - 36} ${h - 2} H ${w - 48} Q ${w - 10} ${h - 2} ${w - 10} ${h - 38} V 152 C ${w - 10} 117 ${w - 50} 112 ${w - 55} 72 C ${w - 58} 38 ${w - 48} 8 ${w - 100} 8 H 76 C 57 8 56 22 44 26 Z`;
  return <svg ref={ref} className="ga-scene-activity-frame" viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
    <defs><linearGradient id="ga-activity-frame-color" x1="0%" y1="0%" x2="100%" y2="0%"><stop offset="0%" stopColor="var(--ga-scene-gradient-start)" /><stop offset="100%" stopColor="var(--ga-scene-gradient-end)" /></linearGradient></defs>
    <path d={path} fill="url(#ga-activity-frame-color)" />
    <circle cx="37" cy="37" r="21" fill="url(#ga-activity-frame-color)" />
  </svg>;
}
