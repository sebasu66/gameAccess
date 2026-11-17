import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useI18n } from "./i18n";
import { resourceGuard } from "./ResourceGuard";
import ResourceMeter from "./ResourceMeter";
import { debugLoggingEnabled, setDebugLogging, subscribeDebugLogging, toggleDebugLogging } from "./debugLog";
import "./operations.css";
export function consoleShortcut(event:KeyboardEvent):boolean{
 const element=event.target as HTMLElement|null;
 return event.code==="Backquote"&&!event.repeat&&!event.isComposing&&!event.ctrlKey&&!event.altKey&&!event.metaKey&&!(element?.closest("input,textarea,select,[contenteditable=true]"));
}
/** Ctrl+Shift+D toggles the profiler alarms without editing localStorage by hand. */
export function profilerShortcut(event:KeyboardEvent):boolean{
 const element=event.target as HTMLElement|null;
 return Boolean(event.code==="KeyD"&&event.ctrlKey&&event.shiftKey&&!event.altKey&&!event.metaKey&&!event.repeat&&!event.isComposing&&!(element?.closest("input,textarea,select,[contenteditable=true]")));
}
/** Ctrl+Shift+L toggles the flag-gated diagnostic logging (Tauri has no F12). */
export function debugLoggingShortcut(event:KeyboardEvent):boolean{
 const element=event.target as HTMLElement|null;
 return Boolean(event.code==="KeyL"&&event.ctrlKey&&event.shiftKey&&!event.altKey&&!event.metaKey&&!event.repeat&&!event.isComposing&&!(element?.closest("input,textarea,select,[contenteditable=true]")));
}
export function redactConsoleLine(line:string):string{
 return line.replace(/(password|authorization|activation[_ -]?key|session[_ -]?token)\s*[:=]\s*[^\s,;]+/gi,"[redacted]").replace(/postgres(?:ql)?:\/\/[^\s]+/gi,"[connection]").replace(/([?&](?:token|key|password|auth)=)[^&\s]+/gi,"$1[redacted]").replace(/bearer\s+[^\s,;]+/gi,"Bearer [redacted]");
}

/** The profiler flag lives in the guard singleton, so mirror it into React. */
function useProfilerEnabled():boolean{
 const subscribe=useCallback((listener:()=>void)=>resourceGuard.subscribeDebug(listener),[]);
 return useSyncExternalStore(subscribe,()=>resourceGuard.isDebugEnabled(),()=>false);
}

/** The diagnostic-logging flag lives in a module singleton too. */
function useDebugLoggingEnabled():boolean{
 const subscribe=useCallback((listener:()=>void)=>subscribeDebugLogging(()=>listener()),[]);
 return useSyncExternalStore(subscribe,debugLoggingEnabled,()=>false);
}

function DebugLogToggle({locale}:{locale:string}){
 const es=locale==="es";
 const enabled=useDebugLoggingEnabled();
 const label=(es?"Diagnóstico":"Diagnostics")+" · "+(enabled?(es?"activo":"on"):(es?"apagado":"off"));
 const title=es?"Registro de diagnóstico detallado (Ctrl+Mayús+L). En Tauri F12 no muestra nada.":"Verbose diagnostic logging (Ctrl+Shift+L). Tauri does not expose F12.";
 return <button type="button" className={"ga-profiler-toggle"+(enabled?" is-on":"")} aria-pressed={enabled} title={title} onClick={()=>setDebugLogging(!enabled)}>
  <span aria-hidden="true">{enabled?"🐞":"○"}</span>{label}
 </button>;
}

function ProfilerToggle({enabled,locale}:{enabled:boolean;locale:string}){
 const es=locale==="es";
 const label=(es?"Alarmas":"Alarms")+" · "+(enabled?(es?"con sonido":"sound on"):(es?"sin sonido":"muted"));
 const title=es?"Alarmas del vigilante de recursos: pulsa para activar o desactivar el sonido (Ctrl+Mayús+D)":"Resource guard alarms: click to toggle the sound (Ctrl+Shift+D)";
 return <button type="button" className={"ga-profiler-toggle"+(enabled?" is-on":"")} aria-pressed={enabled} title={title} onClick={()=>resourceGuard.toggleDebug()}>
  <span aria-hidden="true">{enabled?"🔔":"🔇"}</span>{label}
 </button>;
}

/**
 * The console header.
 *
 * The console has no floating entry point: it used to sit on a corner dock with
 * a "Console" button and the two developer switches beside it, which put debug
 * controls in front of every user. It is a developer tool opened with `~` (see
 * `consoleShortcut`), so it needs no button, and its switches live in here.
 */
function ConsoleHeader({paused,expanded,locale,onTogglePaused,onToggleExpanded,onClose}:{
 paused:boolean;expanded:boolean;locale:string;onTogglePaused:()=>void;onToggleExpanded:()=>void;onClose:()=>void;
}){
 const es=locale==="es";
 const profilerEnabled=useProfilerEnabled();
 return <header>
  <strong>{es?"Actividad de GameAccess":"GameAccess activity"}</strong><span/>
  {/* Diagnostics and alarms appear once the console is expanded, so the default
      view stays a plain log. */}
  {expanded?<>
   <DebugLogToggle locale={locale} />
   <ProfilerToggle enabled={profilerEnabled} locale={locale} />
  </>:<small className="ga-console-hint">{es?"Expandí para diagnóstico y alarmas":"Expand for diagnostics and alarms"}</small>}
  <button type="button" aria-pressed={paused} onClick={onTogglePaused}>{paused?(es?"Reanudar":"Resume"):(es?"Pausar":"Pause")}</button>
  <button type="button" aria-expanded={expanded} onClick={onToggleExpanded}>{expanded?(es?"Reducir":"Collapse"):(es?"Expandir":"Expand")}</button>
  <button type="button" onClick={onClose} aria-label={es?"Cerrar consola":"Close console"}>×</button>
 </header>;
}

/** Polls the native activity log while the console is open and unpaused. */
function useActivityLines(active:boolean,paused:boolean,es:boolean){
 const [lines,setLines]=useState<string[]>([]);
 const [error,setError]=useState("");
 useEffect(()=>{
  if(!active||paused)return;
  let mounted=true,pending=false;
  const read=async()=>{
   if(pending)return;
   pending=true;
   try{
    const raw=await invoke<string[]>("read_activity_console");
    if(mounted){setLines((raw??[]).map(redactConsoleLine).slice(-700));setError("");}
   }catch{
    if(mounted)setError(es?"La consola requiere la aplicación de escritorio.":"The console requires the desktop app.");
   }finally{pending=false;}
  };
  void read();
  const timer=window.setInterval(()=>void read(),1000);
  return()=>{mounted=false;window.clearInterval(timer);};
 },[active,paused,es]);
 return {lines,error};
}

/** Console visibility plus its two global shortcuts. */
function useConsoleChrome(){
 const [open,setOpen]=useState(false);
 const [expanded,setExpanded]=useState(false);
 const [paused,setPaused]=useState(false);
 useEffect(()=>{
  const key=(event:KeyboardEvent)=>{
   if(consoleShortcut(event)){event.preventDefault();event.stopImmediatePropagation();setOpen(v=>!v);}
   else if(profilerShortcut(event)){event.preventDefault();event.stopImmediatePropagation();resourceGuard.toggleDebug();}
   else if(debugLoggingShortcut(event)){event.preventDefault();event.stopImmediatePropagation();toggleDebugLogging();}
   else if(open&&event.code==="Escape"){event.preventDefault();event.stopImmediatePropagation();setOpen(false);}
  };
  window.addEventListener("keydown",key,true);
  return()=>window.removeEventListener("keydown",key,true);
 },[open]);
 return {open,setOpen,expanded,setExpanded,paused,setPaused};
}

export default function ActivityConsole(){
 const {locale}=useI18n();
 const es=locale==="es";
 const {open,setOpen,expanded,setExpanded,paused,setPaused}=useConsoleChrome();
 const {lines,error}=useActivityLines(open,paused,es);
 const logRef=useRef<HTMLPreElement>(null);
 useEffect(()=>{const log=logRef.current;if(log)log.scrollTop=log.scrollHeight;},[lines]);
 if(!open)return null;
 return <section className={"ga-activity-console"+(expanded?" is-expanded":"")} aria-label={es?"Consola de actividad":"Activity console"}>
  <ConsoleHeader paused={paused} expanded={expanded} locale={locale} onTogglePaused={()=>setPaused(v=>!v)} onToggleExpanded={()=>setExpanded(v=>!v)} onClose={()=>setOpen(false)} />
  <ResourceMeter />
  <pre ref={logRef} role="log" aria-live="off">{error||lines.join("\n")||(es?"Esperando actividad…":"Waiting for activity…")}</pre>
 </section>;
}
