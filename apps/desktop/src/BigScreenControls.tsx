import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Gamepad2, Maximize, Minimize } from "lucide-react";
import { GamepadInput, type PadAction } from "./gamepadInput";
import { useOverlayClose } from "./useOverlayClose";
import OverlayScreenDimmer from "./OverlayScreenDimmer";
import { useI18n } from "./i18n";

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
  const { t } = useI18n();
  const latest = useRef(props); latest.current = props;
  const [connected, setConnected] = useState(false);
  const [keyboard, setKeyboard] = useState(false);
  const keyboardRef = useRef(false); keyboardRef.current = keyboard;
  const keyboardPanelRef = useRef<HTMLElement>(null);
  const {closing:keyboardClosing,close:closeKeyboard}=useOverlayClose(() => { setKeyboard(false); document.querySelector<HTMLElement>(".library-room-card.is-selected")?.focus({preventScroll:true}); });
  const closeKeyboardRef=useRef(closeKeyboard);closeKeyboardRef.current=closeKeyboard;
  useEffect(() => { if (!props.enabled) setKeyboard(false); }, [props.enabled]);
  useEffect(() => {
    const input = new GamepadInput(); let frame = 0; let idle = 0; let wasConnected = false; let controller = -1;
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
      // Poll every frame only while a controller is in use; otherwise check a few times a second.
      if (controller >= 0) frame = requestAnimationFrame(tick);
      else idle = window.setTimeout(() => { frame = requestAnimationFrame(tick); }, 300);
    };
    frame=requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(frame); window.clearTimeout(idle); };
  }, []);
  useEffect(() => { if (keyboard) document.querySelector<HTMLElement>(".ga-pad-keyboard button")?.focus({preventScroll:true}); }, [keyboard]);
  const toggle = <button type="button" className="ga-big-screen-toggle ga-dock-btn" aria-pressed={props.enabled} aria-label={props.enabled ? t("bigScreenExit") : t("bigScreenEnter")} title={props.enabled ? t("bigScreenExitHint") : t("bigScreenEnterHint")} onClick={props.onToggle}>{props.enabled ? <Minimize size={22}/> : <Maximize size={22}/>}<span>{props.enabled ? t("bigScreenExitShort") : t("bigScreenEnter")}</span></button>;
  return <>
    {props.footerTarget ? createPortal(toggle, props.footerTarget.closest(".catalog-bottom-actions")?.querySelector<HTMLElement>(".ga-dock") ?? props.footerTarget.closest(".catalog-bottom-actions") ?? props.footerTarget) : toggle}
    {props.enabled ? <div className="ga-pad-hints" aria-label={t("uiControlesDeXbox")}>
      <span className="ga-pad-connection" role="status"><Gamepad2 size={18}/>{connected ? t("padConnected") : t("padConnectPrompt")}</span>
      {[
        ["xbox_button_color_a", "A", t("padOpen")], ["xbox_button_color_b", "B", t("padBack")],
        ["xbox_button_color_x", "X", t("padSearch")], ["xbox_button_color_y", "Y", t("uiFiltros")],
        ["xbox_lb", "LB", t("uiBiblioteca")], ["xbox_rb", "RB", t("tabCatalog")],
        ["xbox_lt", "LT", t("padUp")], ["xbox_rt", "RT", t("padDown")],
        ["xbox_button_menu", t("padMenuButton"), t("bigScreenExitShort")],
      ].map(([icon, button, label]) => <span className="ga-pad-prompt" key={icon}><img src={`/icons/xbox/${icon}.svg`} alt={button}/>{label}</span>)}
    </div> : null}
    {keyboard ? <div className={`ga-pad-keyboard-backdrop${keyboardClosing ? " is-closing" : ""}`}><OverlayScreenDimmer panelRef={keyboardPanelRef} /><section ref={keyboardPanelRef} role="dialog" aria-modal="true" aria-label={t("uiBuscarConMando")} className="ga-pad-keyboard" onKeyDown={event => { if(event.key === "Escape") { event.stopPropagation(); closeKeyboard(); } }}><h2>{t("uiBuscarJuegos")}</h2><output>{props.query || t("padSearchPlaceholder")}</output><div>{"ABCDEFGHIJKLMNÑOPQRSTUVWXYZ0123456789".split("").map(letter => <button type="button" key={letter} onClick={()=>props.onQuery(props.query+letter.toLowerCase())}>{letter}</button>)}</div><footer><button onClick={()=>props.onQuery(props.query+" ")}>{t("uiEspacio")}</button><button onClick={()=>props.onQuery(props.query.slice(0,-1))}>{t("uiBorrar")}</button><button onClick={()=>props.onQuery("")}>{t("uiLimpiar")}</button><button onClick={closeKeyboard}>{t("uiVerResultados")}</button></footer></section></div> : null}
  </>;
}
