import { useEffect, useId, useRef, useState, type RefObject } from "react";

/** A fixed-size visual handle; the target retains native wheel/touch scrolling. */
export default function CircularScrollbar({ targetRef, label }: { targetRef: RefObject<HTMLDivElement>; label: string }) {
  const id = useId();
  const trackRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState({ maximum: 0, value: 0 });
  useEffect(() => {
    const target = targetRef.current;
    if (!target) return;
    const previousId = target.id;
    if (!previousId) target.id = id;
    let frame = 0;
    const update = () => {
      frame = 0;
      setState({ maximum: Math.max(0, target.scrollHeight - target.clientHeight), value: target.scrollTop });
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
  if (state.maximum <= 1) return null;
  const progress = Math.max(0, Math.min(1, state.value / state.maximum));
  return <div ref={trackRef} className="ga-circle-scrollbar" role="scrollbar" tabIndex={0}
    aria-label={label} aria-controls={targetRef.current?.id || id} aria-orientation="vertical"
    aria-valuemin={0} aria-valuemax={Math.round(state.maximum)} aria-valuenow={Math.round(Math.min(state.maximum, state.value))}
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
    <span className="ga-circle-scrollbar-range" aria-hidden="true"><i style={{ top: `${progress * 100}%` }} /></span>
  </div>;
}
