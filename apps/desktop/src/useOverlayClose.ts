import { useCallback, useEffect, useRef, useState } from "react";

/** Keep the dialog mounted and focused during its 180ms exit transition.
 * The latest callback prevents stale filters or selection on completion. */
export function useOverlayClose(onClosed: () => void) {
  const latest = useRef(onClosed); latest.current=onClosed;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [closing,setClosing] = useState(false);
  const close = useCallback(() => {
    if(timer.current !== null) return;
    if(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) { latest.current(); return; }
    setClosing(true);
    timer.current=setTimeout(()=>{timer.current=null;setClosing(false);latest.current();},180);
  },[]);
  useEffect(()=>()=>{if(timer.current !== null) clearTimeout(timer.current);},[]);
  return {closing,close};
}
