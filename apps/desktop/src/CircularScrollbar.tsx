import { useEffect, useId, useRef, useState, type RefObject } from "react";

function placeHandle(track: HTMLElement | null, thumb: HTMLElement | null, value: number, maximum: number): void {
  if (!track || !thumb || maximum <= 1) return;
  thumb.style.top = `${Math.max(0, Math.min(1, value / maximum)) * 100}%`;
  track.setAttribute("aria-valuenow", String(Math.round(Math.min(maximum, value))));
}

/** A fixed-size visual handle; the target retains native wheel/touch scrolling. */
export default function CircularScrollbar({ targetRef, label }: { targetRef: RefObject<HTMLDivElement>; label: string }) {
  const id = useId();
  const trackRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLElement>(null);
  const [maximum, setMaximum] = useState(0);
  useEffect(() => {
    const target = targetRef.current;
    if (!target) return;
    const previousId = target.id;
    if (!previousId) target.id = id;
    let frame = 0;
    // The handle moves on every scroll frame; doing it through state re-rendered the catalog each frame.
    const update = () => {
      frame = 0;
      const max = Math.max(0, target.scrollHeight - target.clientHeight);
      setMaximum(max);
      placeHandle(trackRef.current, thumbRef.current, target.scrollTop, max);
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
    const resize = new ResizeObserver(schedule);
    resize.observe(target);
    const observeContent = () => {
      resize.disconnect();
      resize.observe(target);
      Array.from(target.children).forEach(child => resize.observe(child));
      schedule();
    };
    const mutation = new MutationObserver(observeContent);
    mutation.observe(target, { childList: true, subtree: true });
    target.addEventListener("scroll", schedule, { passive: true });
    observeContent();
    return () => {
      if (frame) cancelAnimationFrame(frame);
      resize.disconnect();
      mutation.disconnect();
      target.removeEventListener("scroll", schedule);
      if (!previousId && target.id === id) target.removeAttribute("id");
    };
  }, [targetRef, id]);
  const moveTo = (clientY: number) => {
    const target = targetRef.current;
    const track = trackRef.current;
    if (!target || !track) return;
    const rect = track.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientY - rect.top - 10) / Math.max(1, rect.height - 20)));
    target.scrollTop = ratio * Math.max(0, target.scrollHeight - target.clientHeight);
  };
  if (maximum <= 1) return null;
  const value = targetRef.current?.scrollTop ?? 0;
  return <div ref={trackRef} className="ga-circle-scrollbar" role="scrollbar" tabIndex={-1}
    aria-label={label} aria-controls={targetRef.current?.id || id} aria-orientation="vertical"
    aria-valuemin={0} aria-valuemax={Math.round(maximum)} aria-valuenow={Math.round(Math.min(maximum, value))}
    onPointerDown={event => { if (event.button !== 0) return; event.preventDefault(); event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId); moveTo(event.clientY); }}
    onPointerMove={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) moveTo(event.clientY); }}
    onPointerUp={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
    onKeyDown={event => {
      const target = targetRef.current;
      if (!target) return;
      const moves: Record<string, number> = { ArrowDown: 40, ArrowUp: -40, PageDown: target.clientHeight * .9, PageUp: -target.clientHeight * .9, Home: -target.scrollHeight, End: target.scrollHeight };
      const amount = moves[event.key];
      if (amount === undefined) return;
      event.preventDefault(); event.stopPropagation(); target.scrollTop += amount;
    }}>
    <span className="ga-circle-scrollbar-range" aria-hidden="true"><i ref={thumbRef} style={{ top: `${Math.max(0, Math.min(1, value / maximum)) * 100}%` }} /></span>
  </div>;
}
