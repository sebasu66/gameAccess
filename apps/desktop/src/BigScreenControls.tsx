import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Gamepad2, Maximize, Minimize } from "lucide-react";
import { GamepadInput, type PadAction } from "./gamepadInput";
import { useOverlayClose } from "./useOverlayClose";
import OverlayScreenDimmer from "./OverlayScreenDimmer";

type Props = { footerTarget?: HTMLDivElement | null; enabled: boolean; onToggle: () => void; onDirection: (key: string) => void; onAccept: () => void; onBack: () => void; onView: (view: "installed" | "catalog") => void; query: string; onQuery: (query: string) => void };
function dialogScope() { return document.querySelector<HTMLElement>('[role="menu"]') ?? document.querySelector<HTMLElement>('[role="dialog"][aria-modal="true"]'); }
function focusDirection(scope: HTMLElement, direction: string) {
  const nodes = Array.from(scope.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), summary, a[href]')).filter(node => node.getClientRects().length > 0);
  const active = document.activeElement as HTMLElement;
  if (!nodes.includes(active)) { nodes[0]?.focus({ preventScroll:true }); return; }
  const rect = active.getBoundingClientRect(), x = rect.left + rect.width/2, y = rect.top + rect.height/2;
  const candidates = nodes.filter(node => node !== active).map(node => {
    const r = node.getBoundingClientRect(), dx = r.left+r.width/2-x, dy = r.top+r.height/2-y;
    const along = direction === "right" ? dx : direction === "left" ? -dx : direction === "down" ? dy : -dy;
    const across = ["left","right"].includes(direction) ? Math.abs(dy) : Math.abs(dx);
    return { node, along, score:along+across*3 };
  }).filter(item => item.along > 2).sort((a,b) => a.score-b.score);
  candidates[0]?.node.focus({ preventScroll:true });
  candidates[0]?.node.scrollIntoView({ block:"nearest", inline:"nearest" });
}
export default function BigScreenControls(props: Props) {
  const latest = useRef(props); latest.current = props;
  const [connected, setConnected] = useState(false);
  const [keyboard, setKeyboard] = useState(false);
  const keyboardRef = useRef(false); keyboardRef.current = keyboard;
  const keyboardPanelRef = useRef<HTMLElement>(null);
  const {closing:keyboardClosing,close:closeKeyboard}=useOverlayClose(() => { setKeyboard(false); document.querySelector<HTMLElement>(".library-room-card.is-selected")?.focus({preventScroll:true}); });
  const closeKeyboardRef=useRef(closeKeyboard);closeKeyboardRef.current=closeKeyboard;
  useEffect(() => { if (!props.enabled) setKeyboard(false); }, [props.enabled]);
  useEffect(() => {
    const input = new GamepadInput(); let frame = 0; let wasConnected = false; let controller = -1;
    const dispatch = (action: PadAction) => {
      const p = latest.current;
      if (action === "toggle") { if (!dialogScope()) p.onToggle(); return; }
      if (!p.enabled) return;
      const scope = dialogScope();
      if (action === "pageup" || action === "pagedown") {
        const panel = scope?.querySelector<HTMLElement>(".ga-detail-scroll,.ga-filter-groups") ?? document.querySelector<HTMLElement>(".library-room-grid");
        panel?.scrollBy({top:(action === "pagedown" ? 1 : -1)*(panel.clientHeight*.7),behavior:"auto"});
        return;
      }
      if (["left","right","up","down"].includes(action)) {
        if (scope) focusDirection(scope, action);
        else p.onDirection(`arrow${action}`);
      } else if (action === "accept") {
        if (scope) {
          const active = document.activeElement as HTMLElement;
          if (scope.contains(active)) active.click();
          else scope.querySelector<HTMLElement>("button,input")?.focus();
        } else p.onAccept();
      } else if (action === "back") {
        if (keyboardRef.current) closeKeyboardRef.current();
        else if (scope) (document.activeElement ?? scope).dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}));
        else p.onBack();
      } else if (!scope && action === "search") setKeyboard(true);
      else if (!scope && action === "filters") document.querySelector<HTMLButtonElement>(".ga-filter-open")?.click();
      else if (!scope && (action === "library" || action === "catalog")) p.onView(action === "library" ? "installed" : "catalog");
    };
    const tick = (now: number) => {
      if (document.visibilityState === "visible" && document.hasFocus()) {
        const pad = Array.from(navigator.getGamepads?.() ?? []).find(pad => pad?.connected && pad.mapping === "standard");
        if (Boolean(pad) !== wasConnected) { wasConnected = Boolean(pad); setConnected(wasConnected); }
        if (pad) { if (controller !== pad.index) { input.reset(); controller=pad.index; } input.read(pad,now).forEach(dispatch); }
        else { input.reset(); controller=-1; }
      } else input.reset();
      frame=requestAnimationFrame(tick);
    };
    frame=requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);
  useEffect(() => { if (keyboard) document.querySelector<HTMLElement>(".ga-pad-keyboard button")?.focus({preventScroll:true}); }, [keyboard]);
  const toggle = <button type="button" className="ga-big-screen-toggle" aria-pressed={props.enabled} aria-label={props.enabled ? "Salir de pantalla grande" : "Pantalla grande"} title={props.enabled ? "Salir de pantalla grande (F11 / Start)" : "Pantalla grande (F11 / Start)"} onClick={props.onToggle}>{props.enabled ? <Minimize size={22}/> : <Maximize size={22}/>}<span>{props.enabled ? "Salir" : "Pantalla grande"}</span></button>;
  return <>
    {props.footerTarget ? createPortal(toggle, props.footerTarget.closest(".catalog-bottom-actions") ?? props.footerTarget) : toggle}
    {props.enabled ? <div className="ga-pad-hints" aria-label="Controles de Xbox">
      <span className="ga-pad-connection" role="status"><Gamepad2 size={18}/>{connected ? "Mando conectado" : "Conectá un mando"}</span>
      {[
        ["xbox_button_color_a", "A", "Abrir"], ["xbox_button_color_b", "B", "Volver"],
        ["xbox_button_color_x", "X", "Buscar"], ["xbox_button_color_y", "Y", "Filtros"],
        ["xbox_lb", "LB", "Biblioteca"], ["xbox_rb", "RB", "Catálogo"],
        ["xbox_lt", "LT", "Subir"], ["xbox_rt", "RT", "Bajar"],
        ["xbox_button_menu", "Menú", "Salir"],
      ].map(([icon, button, label]) => <span className="ga-pad-prompt" key={icon}><img src={`/icons/xbox/${icon}.svg`} alt={button}/>{label}</span>)}
    </div> : null}
    {keyboard ? <div className={`ga-pad-keyboard-backdrop${keyboardClosing ? " is-closing" : ""}`}><OverlayScreenDimmer panelRef={keyboardPanelRef} /><section ref={keyboardPanelRef} role="dialog" aria-modal="true" aria-label="Buscar con mando" className="ga-pad-keyboard" onKeyDown={event => { if(event.key === "Escape") { event.stopPropagation(); closeKeyboard(); } }}><h2>Buscar juegos</h2><output>{props.query || "Escribí un título, género o etiqueta"}</output><div>{"ABCDEFGHIJKLMNÑOPQRSTUVWXYZ0123456789".split("").map(letter => <button type="button" key={letter} onClick={()=>props.onQuery(props.query+letter.toLowerCase())}>{letter}</button>)}</div><footer><button onClick={()=>props.onQuery(props.query+" ")}>Espacio</button><button onClick={()=>props.onQuery(props.query.slice(0,-1))}>Borrar</button><button onClick={()=>props.onQuery("")}>Limpiar</button><button onClick={closeKeyboard}>Ver resultados</button></footer></section></div> : null}
  </>;
}
