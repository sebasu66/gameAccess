import { useId, useEffect, useRef, useState, type RefObject } from "react";

/** A real fullscreen scrim with a hole around the glass panel. Unlike a large
 * shadow, this layer explicitly paints every pixel outside the dialog. With the device frame the overlay sits
 * inside the frame while the scrim reaches out to the window's edges (device-frame.css), so the hole is placed
 * from the scrim's own corner, not the overlay's. */
export default function OverlayScreenDimmer({ panelRef }: { panelRef: RefObject<HTMLElement> }) {
  const id = `ga-scrim-${useId().replace(/:/g, "")}`;
  const [bounds, setBounds] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const scrim = useRef<SVGSVGElement>(null);
  // Run after sibling dialog refs attach; a layout effect on this earlier
  // sibling can run before React attaches the panel's ref.
  useEffect(() => {
    const panel=panelRef.current;
    if(!panel) return;
    // Layout offsets (not on-screen boxes): the panel's open/close morph moves it with transforms.
    const shift=()=>{const box=scrim.current?.getBoundingClientRect(),parent=scrim.current?.parentElement?.getBoundingClientRect();return box&&parent?{x:parent.left-box.left,y:parent.top-box.top}:{x:0,y:0};};
    const measure=()=>{const {x,y}=shift();setBounds({x:panel.offsetLeft+x,y:panel.offsetTop+y,width:panel.offsetWidth,height:panel.offsetHeight});};
    const observer=new ResizeObserver(measure);
    observer.observe(panel); if(panel.parentElement) observer.observe(panel.parentElement);
    window.addEventListener("resize",measure); measure();
    return()=>{observer.disconnect();window.removeEventListener("resize",measure);};
  },[panelRef]);
  return <svg ref={scrim} className="ga-screen-dimmer" aria-hidden="true" focusable="false" opacity={bounds ? 1 : 0} width="100%" height="100%">
    <defs><mask id={id} style={{maskType:"luminance"}} maskUnits="userSpaceOnUse" x="0" y="0" width="100%" height="100%">
      <rect width="100%" height="100%" fill="white" />
      {bounds ? <rect x={bounds.x} y={bounds.y} width={bounds.width} height={bounds.height} rx="12" fill="black" /> : null}
    </mask></defs>
    <rect width="100%" height="100%" fill="black" mask={`url(#${id})`} />
  </svg>;
}
