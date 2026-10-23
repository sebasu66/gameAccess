import { useId, useEffect, useState, type RefObject } from "react";

/** A real fullscreen scrim with a hole around the glass panel. Unlike a large
 * shadow, this layer explicitly paints every pixel outside the dialog. */
export default function OverlayScreenDimmer({ panelRef }: { panelRef: RefObject<HTMLElement> }) {
  const id = `ga-scrim-${useId().replace(/:/g, "")}`;
  const [bounds, setBounds] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  // Run after sibling dialog refs attach; a layout effect on this earlier
  // sibling can run before React attaches the panel's ref.
  useEffect(() => {
    const panel=panelRef.current;
    if(!panel) return;
    const measure=()=>setBounds({x:panel.offsetLeft,y:panel.offsetTop,width:panel.offsetWidth,height:panel.offsetHeight});
    const observer=new ResizeObserver(measure);
    observer.observe(panel); if(panel.parentElement) observer.observe(panel.parentElement);
    window.addEventListener("resize",measure); measure();
    return()=>{observer.disconnect();window.removeEventListener("resize",measure);};
  },[panelRef]);
  return <svg className="ga-screen-dimmer" aria-hidden="true" focusable="false" opacity={bounds ? 1 : 0} width="100%" height="100%">
    <defs><mask id={id} style={{maskType:"luminance"}} maskUnits="userSpaceOnUse" x="0" y="0" width="100%" height="100%">
      <rect width="100%" height="100%" fill="white" />
      {bounds ? <rect x={bounds.x} y={bounds.y} width={bounds.width} height={bounds.height} rx="12" fill="black" /> : null}
    </mask></defs>
    <rect width="100%" height="100%" fill="black" mask={`url(#${id})`} />
  </svg>;
}
