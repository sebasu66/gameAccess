import { useEffect, useRef, useState } from "react";
import type { CatalogGame } from "./types";
import type { DownloadProgressSnapshot } from "./downloadProvider";
import { downloadPhaseLabel, formatDownloadBytes } from "./DigitalDownloadsScreen";
import { useI18n } from "./i18n";
import { clampOrb, progressSegments, type OrbPosition } from "./downloadIndicatorLayout";

const POSITION_KEY = "gameaccess:download-orb-position:v1";
function initialPosition(): OrbPosition {
  if (typeof window === "undefined") return {x:12,y:80};
  try {
    const saved = JSON.parse(localStorage.getItem(POSITION_KEY) ?? "null");
    if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) return clampOrb({x:saved.x * innerWidth,y:saved.y * innerHeight}, innerWidth, innerHeight);
  } catch { /* A bad saved position must not hide downloads. */ }
  return clampOrb({x:innerWidth-380,y:innerHeight-240}, innerWidth, innerHeight);
}
function savePosition(position: OrbPosition) {
  try { localStorage.setItem(POSITION_KEY, JSON.stringify({x:position.x/innerWidth,y:position.y/innerHeight})); } catch { /* Optional preference. */ }
}
const ringCells = Array.from({length:48}, (_, i) => {
  const start = (i * 7.5 - 90) * Math.PI / 180, end = start + 5 * Math.PI / 180;
  return `M ${50+43*Math.cos(start)} ${50+43*Math.sin(start)} A 43 43 0 0 1 ${50+43*Math.cos(end)} ${50+43*Math.sin(end)}`;
});
export default function FloatingDownloadIndicator({game,snapshot,additional,onOpen}: {
  game:CatalogGame; snapshot:DownloadProgressSnapshot; additional:number; onOpen:()=>void;
}) {
  const {t,locale} = useI18n();
  const [position,setPosition] = useState(initialPosition);
  const positionRef = useRef(position); positionRef.current = position;
  const drag = useRef<{pointer:number; x:number; y:number; origin:OrbPosition; moved:boolean} | null>(null);
  const [dragging,setDragging] = useState(false);
  const sources = [...new Set([game.capsule_image,game.header_image,game.hero_image].filter((source): source is string => Boolean(source)))];
  const [imageIndex,setImageIndex] = useState(0);
  const artworkKey = JSON.stringify([game.id,sources]);
  useEffect(() => setImageIndex(0), [artworkKey]);
  useEffect(() => {
    const resize = () => setPosition(current => clampOrb(current,innerWidth,innerHeight));
    window.addEventListener("resize",resize);
    return () => window.removeEventListener("resize",resize);
  }, []);
  const percent = Math.max(0,Math.min(100,Number.isFinite(snapshot.progress) ? snapshot.progress : 0));
  const cells = progressSegments(percent);
  const status = downloadPhaseLabel(snapshot.phase,locale);
  const indeterminate = ["preparing","queued"].includes(snapshot.phase);
  const image = sources[imageIndex];
  const left = typeof window !== "undefined" && position.x + 370 > innerWidth;
  const finishDrag = (event: React.PointerEvent<HTMLButtonElement>, cancelled=false) => {
    if (drag.current?.pointer !== event.pointerId) return;
    if (cancelled) drag.current.moved = true;
    setDragging(false);
    savePosition(positionRef.current);
  };
  return <div className={`ga-download-orb${left ? " panel-left" : ""}${dragging ? " is-dragging" : ""}`} style={{left:position.x,top:position.y}}>
    <span className="ga-download-orb-label">{snapshot.phase === "downloading" ? `${status}…` : status}</span>
    <button type="button" className="ga-download-orb-button" onClick={event => {if(drag.current?.moved) {event.preventDefault();drag.current=null;return;} onOpen();}}
      aria-label={t("downloadsOrbAria",{name:game.name,status,percent:Math.round(percent)})}
      title={t("downloadsMoveHint")}
      onPointerDown={event => {
        if(event.button!==0 || !event.isPrimary) return;
        drag.current={pointer:event.pointerId,x:event.clientX,y:event.clientY,origin:positionRef.current,moved:false};
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={event => {
        const current=drag.current;
        if(!current || current.pointer!==event.pointerId || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
        const dx=event.clientX-current.x,dy=event.clientY-current.y;
        if(!current.moved && Math.hypot(dx,dy)<5) return;
        current.moved=true; setDragging(true);
        const next=clampOrb({x:current.origin.x+dx,y:current.origin.y+dy},innerWidth,innerHeight);
        positionRef.current=next;setPosition(next);
      }}
      onPointerUp={event=>finishDrag(event)} onPointerCancel={event=>finishDrag(event,true)} onLostPointerCapture={()=>setDragging(false)}
      onKeyDown={event => {
        if(event.key === "Enter" || event.key === " ") drag.current=null;
        if(!event.altKey || !["ArrowLeft","ArrowRight","ArrowUp","ArrowDown"].includes(event.key)) return;
        event.preventDefault();event.stopPropagation();
        const next=clampOrb({x:position.x+(event.key==="ArrowRight"?24:event.key==="ArrowLeft"?-24:0),y:position.y+(event.key==="ArrowDown"?24:event.key==="ArrowUp"?-24:0)},innerWidth,innerHeight);
        setPosition(next);savePosition(next);
      }}>
      <span className="ga-download-orb-cover">{image ? <img src={image} alt="" draggable={false} onError={()=>setImageIndex(current=>current+1)}/> : <span aria-hidden="true">↓</span>}</span>
      <svg className={indeterminate ? "is-indeterminate" : ""} viewBox="0 0 100 100" role="progressbar" aria-label={t("downloadsProgress",{name:game.name,status})} aria-valuemin={0} aria-valuemax={100} aria-valuenow={indeterminate?undefined:Math.round(percent)} aria-valuetext={status}>
        {ringCells.map((d,index)=><path key={index} d={d} className={index<cells ? "is-filled" : ""}/>)}
      </svg>
      {additional>0 ? <span className="ga-download-orb-count" aria-label={t("downloadsAdditional",{count:additional})}>+{additional}</span> : null}
    </button>
    <div className="ga-download-orb-details" aria-hidden="true"><strong>{game.name}</strong><span>{Math.round(percent)}%<i/> {formatDownloadBytes(snapshot.speedBps,locale)} / s</span><small>{status} · {t("downloadsOpen")}</small></div>
  </div>;
}
