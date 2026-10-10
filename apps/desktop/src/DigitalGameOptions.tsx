import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { useI18n } from "./i18n";
import { useDialogFocus } from "./dialogFocus";
import { digitalProcessManager, type DigitalLaunchOptions } from "./catalog/DigitalProcessManager";
import type { CatalogGame } from "./types";
const copy = {
 es: {title:"Idioma y ejecución",language:"Idioma del juego",repair:"Buscar y reparar idioma",hint:"Busca ajustes de idioma en archivos INI y conserva una copia original. El juego necesita incluir ese idioma.",advanced:"Opciones avanzadas de ejecución",exe:"Archivo ejecutable",automatic:"Detectar automáticamente",args:"Argumentos de lanzamiento",admin:"Ejecutar como administrador",adminHint:"Windows pedirá autorización al jugar.",save:"Guardar opciones",close:"Cerrar",saved:"Opciones guardadas.",repaired:"Archivos corregidos",none:"No se encontraron ajustes de idioma que cambiar.",backup:"La restauración de respaldos y los ajustes automáticos siguen activos.",loading:"Leyendo archivos del juego…",spanish:"Español",english:"Inglés",portuguese:"Portugués",french:"Francés",german:"Alemán"},
 en: {title:"Language and launch",language:"Game language",repair:"Find and repair language",hint:"Finds language settings in INI files and keeps an original backup. The game must include that language.",advanced:"Advanced launch options",exe:"Executable file",automatic:"Detect automatically",args:"Launch arguments",admin:"Run as administrator",adminHint:"Windows will ask for permission when you play.",save:"Save options",close:"Close",saved:"Options saved.",repaired:"Files repaired",none:"No language settings needed changing.",backup:"Archive restoration and automatic fixes remain active.",loading:"Reading game files…",spanish:"Spanish",english:"English",portuguese:"Portuguese",french:"French",german:"German"},
};
export default function DigitalGameOptions({game,onClose,disabled=false}:{game:CatalogGame;onClose:()=>void;disabled?:boolean}) {
 const {locale}=useI18n(); const c=copy[locale];
 const ref=useDialogFocus(onClose);
 const [options,setOptions]=useState<DigitalLaunchOptions>({executable:"",arguments:"",administrator:false,language:"spanish"});
 const [executables,setExecutables]=useState<string[]>([]);
 const [loading,setLoading]=useState(true); const [busy,setBusy]=useState(false);
 const [message,setMessage]=useState(""); const [error,setError]=useState("");
 useEffect(()=>{let live=true; void digitalProcessManager.gameOptions(game).then(result=>{
   if(live){if(result.options) setOptions(result.options);setExecutables(result.executables??[]);}
 }).catch(error=>{if(live)setError(String(error));}).finally(()=>{if(live)setLoading(false);});return()=>{live=false;};},[game.app_id,game.id]);
 const save=async(repair=false)=>{
   setBusy(true);setError("");setMessage("");
   try {
     await digitalProcessManager.saveGameOptions(game,options);
     if(repair){const result=await digitalProcessManager.repairLanguage(game);
       setMessage(result.changed?.length ? c.repaired+": "+result.changed.join(", ") : c.none);
       if(result.errors?.length) setError(result.errors.map(item=>item.file+": "+item.error).join("\n"));
     }else setMessage(c.saved);
   }catch(error){setError(String(error));}finally{setBusy(false);}
 };
 const locked=disabled||loading||busy;
 return <div className="ga-settings-backdrop" onPointerDown={event=>event.stopPropagation()} onClick={event=>{if(event.target===event.currentTarget&&!busy)onClose();}}>
  <section ref={ref} className="ga-settings-panel ga-game-config" role="dialog" aria-modal="true" aria-labelledby="game-config-title">
   <header><div><span className="eyebrow">{game.name}</span><h2 id="game-config-title">{c.title}</h2></div><button type="button" onClick={onClose} disabled={busy} aria-label={c.close} data-dialog-initial><X size={20}/></button></header>
   <div className="ga-settings-content">
    {loading?<p role="status">{c.loading}</p>:null}
    <label className="ga-path-control"><span>{c.language}</span><select value={options.language} disabled={locked} onChange={event=>setOptions({...options,language:event.target.value})}>{(["spanish","english","portuguese","french","german"] as const).map(language=><option key={language} value={language}>{c[language]}</option>)}</select></label>
    <p>{c.hint}</p><button type="button" disabled={locked} onClick={()=>void save(true)}>{c.repair}</button>
    <details className="ga-settings-group"><summary>{c.advanced}</summary>
     <label className="ga-path-control"><span>{c.exe}</span><select value={options.executable} disabled={locked} onChange={event=>setOptions({...options,executable:event.target.value})}><option value="">{c.automatic}</option>{options.executable&&!executables.includes(options.executable)?<option value={options.executable}>{options.executable}</option>:null}{executables.map(executable=><option key={executable} value={executable}>{executable}</option>)}</select></label>
     <label className="ga-path-control"><span>{c.args}</span><input value={options.arguments} disabled={locked} onChange={event=>setOptions({...options,arguments:event.target.value})} placeholder='-windowed'/></label>
     <label className="ga-style-toggle"><input type="checkbox" checked={options.administrator} disabled={locked} onChange={event=>setOptions({...options,administrator:event.target.checked})}/>{c.admin}</label><p>{c.adminHint}</p>
    </details>
    <p>{c.backup}</p>{message?<p role="status">{message}</p>:null}{error?<p className="ga-settings-error" role="alert">{error}</p>:null}
   </div>
   <footer><button type="button" disabled={locked} onClick={()=>void save()}>{c.save}</button></footer>
  </section>
 </div>;
}
