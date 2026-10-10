import {useEffect,useRef,useState} from "react";
import {invoke} from "@tauri-apps/api/core";
import {useI18n} from "./i18n";
import "./operations.css";
export function consoleShortcut(event:KeyboardEvent):boolean{
 const element=event.target as HTMLElement|null;
 return event.code==="Backquote"&&!event.repeat&&!event.isComposing&&!event.ctrlKey&&!event.altKey&&!event.metaKey&&!element?.closest("input,textarea,select,[contenteditable=true]");
}
export function redactConsoleLine(line:string):string{
 return line.replace(/(password|authorization|activation[_ -]?key|session[_ -]?token)\s*[:=]\s*[^\s,;]+/gi,"[redacted]").replace(/postgres(?:ql)?:\/\/[^\s]+/gi,"[connection]").replace(/([?&](?:token|key|password|auth)=)[^&\s]+/gi,"$1[redacted]").replace(/bearer\s+[^\s,;]+/gi,"Bearer [redacted]");
}
export default function ActivityConsole(){
 const {locale}=useI18n();const es=locale==="es";const [open,setOpen]=useState(false);const [expanded,setExpanded]=useState(false);const [paused,setPaused]=useState(false);const [lines,setLines]=useState<string[]>([]);const [error,setError]=useState("");const logRef=useRef<HTMLPreElement>(null);
 useEffect(()=>{const key=(event:KeyboardEvent)=>{if(consoleShortcut(event)){event.preventDefault();event.stopImmediatePropagation();setOpen(v=>!v);}else if(open&&event.code==="Escape"){event.preventDefault();event.stopImmediatePropagation();setOpen(false);}};window.addEventListener("keydown",key,true);return()=>window.removeEventListener("keydown",key,true);},[open]);
 useEffect(()=>{if(!open||paused)return;let active=true,pending=false;const read=async()=>{if(pending)return;pending=true;try{const raw=await invoke<string[]>("read_activity_console");if(active){setLines((raw??[]).map(redactConsoleLine).slice(-700));setError("");}}catch{if(active)setError(es?"La consola requiere la aplicación de escritorio.":"The console requires the desktop app.");}finally{pending=false;}};void read();const timer=window.setInterval(()=>void read(),1000);return()=>{active=false;window.clearInterval(timer);};},[open,paused,es]);
 useEffect(()=>{const log=logRef.current;if(log)log.scrollTop=log.scrollHeight;},[lines]);
 if(!open)return <button className="ga-console-toggle" type="button" title={es?"Consola · tecla a la izquierda del 1":"Console · key to the left of 1"} onClick={()=>setOpen(true)}>{es?"Consola":"Console"} <kbd>~</kbd></button>;
 return <section className={"ga-activity-console"+(expanded?" is-expanded":"")} aria-label={es?"Consola de actividad":"Activity console"}>
  <header><strong>{es?"Actividad de GameAccess":"GameAccess activity"}</strong><span/><button type="button" aria-pressed={paused} onClick={()=>setPaused(v=>!v)}>{paused?(es?"Reanudar":"Resume"):(es?"Pausar":"Pause")}</button><button type="button" aria-expanded={expanded} onClick={()=>setExpanded(v=>!v)}>{expanded?(es?"Reducir":"Collapse"):(es?"Expandir":"Expand")}</button><button type="button" onClick={()=>setOpen(false)} aria-label={es?"Cerrar consola":"Close console"}>×</button></header>
  <pre ref={logRef} role="log" aria-live="off">{error||lines.join("\n")||(es?"Esperando actividad…":"Waiting for activity…")}</pre>
 </section>;
}
