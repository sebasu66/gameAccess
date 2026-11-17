import { useCallback, useEffect, useRef, useState } from "react";

/** Keep the dialog mounted and focused during its 180ms exit transition.
 * The latest callback prevents stale filters or selection on completion.
 * `animateOut` may return a promise for a custom exit (the game detail folding into its card); while it runs,
 * `morphing` is true instead of `closing`, and the dialog unmounts when it resolves. */
export function useOverlayClose(onClosed: () => void, animateOut?: () => Promise<void> | null) {
  const latest = useRef(onClosed); latest.current=onClosed;
  const exit = useRef(animateOut); exit.current=animateOut;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const busy = useRef(false);
  const [closing,setClosing] = useState(false);
  const [morphing,setMorphing] = useState(false);
  const close = useCallback(() => {
    if(timer.current !== null || busy.current) return;
    if(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) { latest.current(); return; }
    const custom = exit.current?.();
    if(custom) {
      busy.current=true; setMorphing(true);
      void custom.finally(()=>{busy.current=false;setMorphing(false);latest.current();});
      return;
    }
    setClosing(true);
    timer.current=setTimeout(()=>{timer.current=null;setClosing(false);latest.current();},180);
  },[]);
  useEffect(()=>()=>{if(timer.current !== null) clearTimeout(timer.current);},[]);
  return {closing,morphing,close};
}
