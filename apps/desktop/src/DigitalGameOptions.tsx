import { GaButton, GaClose } from "./components/ga/Buttons";
import { useEffect, useState } from "react";
import { getSteamStoreLanguage, useI18n } from "./i18n";
import { useDialogFocus } from "./dialogFocus";
import GaTabs from "./GaTabs";
import { emptyAutomation, loadAutomation, saveAutomation, type AutomationFields } from "./catalog/ExecutionProfiles";
import { digitalProcessManager, type DigitalLaunchOptions } from "./catalog/DigitalProcessManager";
import type { CatalogGame } from "./types";
const copy = {
 es: {title:"Idioma y ejecución",language:"Idioma del juego",repair:"Buscar y reparar idioma",hint:"Busca ajustes de idioma en archivos INI y conserva una copia original. El juego necesita incluir ese idioma.",tabLanguage:"Idioma",tabLaunch:"Ejecución",keep:"No cambiar el idioma del juego",keepHint:"El juego queda con el idioma que trae. Si GameAccess lo había cambiado, al jugar vuelve al original.",exe:"Archivo ejecutable",automatic:"Detectar automáticamente",args:"Argumentos de lanzamiento",admin:"Ejecutar como administrador",adminHint:"Windows pedirá autorización al jugar.",decompress:"Descomprimir el fix en cada ejecución",decompressHint:"Antes de jugar, el fix o crack se vuelve a descomprimir sobre el juego, por si el antivirus borró archivos.",save:"Guardar opciones",close:"Cerrar",saved:"Opciones guardadas.",repaired:"Archivos corregidos",none:"No se encontraron ajustes de idioma que cambiar.",backup:"La restauración de respaldos y los ajustes automáticos siguen activos.",loading:"Leyendo archivos del juego…",spanish:"Español",english:"Inglés",portuguese:"Portugués",french:"Francés",german:"Alemán",appLanguage:"Idioma de la aplicación"},
 en: {title:"Language and launch",language:"Game language",repair:"Find and repair language",hint:"Finds language settings in INI files and keeps an original backup. The game must include that language.",tabLanguage:"Language",tabLaunch:"Launch",keep:"Don't change the game's language",keepHint:"The game keeps the language it ships with. If GameAccess had changed it, it goes back to the original when you play.",exe:"Executable file",automatic:"Detect automatically",args:"Launch arguments",admin:"Run as administrator",adminHint:"Windows will ask for permission when you play.",decompress:"Extract the fix on every launch",decompressHint:"Before playing, the fix or crack is extracted over the game again, in case antivirus deleted files.",save:"Save options",close:"Close",saved:"Options saved.",repaired:"Files repaired",none:"No language settings needed changing.",backup:"Archive restoration and automatic fixes remain active.",loading:"Reading game files…",spanish:"Spanish",english:"English",portuguese:"Portuguese",french:"French",german:"German",appLanguage:"App language"},
};
export default function DigitalGameOptions({game,onClose,disabled=false}:{game:CatalogGame;onClose:()=>void;disabled?:boolean}) {
 const {locale}=useI18n(); const c=copy[locale];
 const ref=useDialogFocus(onClose);
 const [options,setOptions]=useState<DigitalLaunchOptions>({executable:"",arguments:"",administrator:false,language:""});
 const [executables,setExecutables]=useState<string[]>([]);
 const [automation,setAutomation]=useState<AutomationFields>(emptyAutomation);
 const [loading,setLoading]=useState(true); const [busy,setBusy]=useState(false);
 const [message,setMessage]=useState(""); const [error,setError]=useState("");
 useEffect(()=>{let live=true; void digitalProcessManager.gameOptions(game).then(result=>{
   if(live){if(result.options) setOptions(result.options);setExecutables(result.executables??[]);}
   return loadAutomation(game.app_id??game.id).then(found=>{if(live)setAutomation(found);});
 }).catch(error=>{if(live)setError(String(error));}).finally(()=>{if(live)setLoading(false);});return()=>{live=false;};},[game.app_id,game.id]);
 const save=async(repair=false)=>{
   setBusy(true);setError("");setMessage("");
   try {
     // One switch for the fix: the options' re-apply and the profile's (when it declares an archive) follow it together.
     await digitalProcessManager.saveGameOptions(game,{...options,backupEnabled:decompress,backupArchive:""});
     await saveAutomation(game.app_id??game.id,automation);
     if(repair){const result=await digitalProcessManager.repairLanguage(game);
       setMessage(result.changed?.length ? c.repaired+": "+result.changed.join(", ") : c.none);
       if(result.errors?.length) setError(result.errors.map(item=>item.file+": "+item.error).join("\n"));
     }else setMessage(c.saved);
   }catch(error){setError(String(error));}finally{setBusy(false);}
 };
 const locked=disabled||loading||busy;
 const keep=options.language==="keep";
 // The fix is re-applied unless the options switched it off, or the profile declares an archive and switched it off.
 const decompress=options.backupEnabled!==false&&(automation.decompressFile?automation.decompressEachRun:true);
 const setDecompress=(on:boolean)=>{setOptions({...options,backupEnabled:on});setAutomation({...automation,decompressEachRun:on});};
 // Either switch runs the game as administrator (the options' and the profile's): the one box shows and sets both.
 const admin=options.administrator||automation.runAsAdmin;
 const setAdmin=(on:boolean)=>{setOptions({...options,administrator:on});setAutomation({...automation,runAsAdmin:on});};
 return <div className="ga-settings-backdrop" onPointerDown={event=>event.stopPropagation()} onClick={event=>{if(event.target===event.currentTarget&&!busy)onClose();}}>
  <section ref={ref} className="ga-settings-panel ga-game-config" role="dialog" aria-modal="true" aria-labelledby="game-config-title">
   <header><div><span className="eyebrow">{game.name}</span><h2 id="game-config-title">{c.title}</h2></div><GaClose label={c.close} onClick={onClose} disabled={busy} data-dialog-initial /></header>
   <div className="ga-settings-content">
    {loading?<p className="ga-status" role="status">{c.loading}</p>:null}
    <GaTabs label={c.title} tabs={[{id:"language",label:c.tabLanguage,content:<div className="ga-stack">
     <label className="ga-path-control"><span>{c.language}</span><select value={options.language} disabled={locked} onChange={event=>setOptions({...options,language:event.target.value})}>
      <option value="">{c.appLanguage} ({c[getSteamStoreLanguage()]})</option><option value="keep">{c.keep}</option>
      {(["spanish","english","portuguese","french","german"] as const).map(language=><option key={language} value={language}>{c[language]}</option>)}</select></label>
     <p className="ga-hint">{keep?c.keepHint:c.hint}</p>
     {keep?null:<GaButton disabled={locked} onClick={()=>void save(true)}>{c.repair}</GaButton>}
    </div>},{id:"launch",label:c.tabLaunch,content:<div className="ga-stack">
     <label className="ga-path-control"><span>{c.exe}</span><select value={options.executable} disabled={locked} onChange={event=>setOptions({...options,executable:event.target.value})}><option value="">{c.automatic}</option>{options.executable&&!executables.includes(options.executable)?<option value={options.executable}>{options.executable}</option>:null}{executables.map(executable=><option key={executable} value={executable}>{executable}</option>)}</select></label>
     <label className="ga-path-control"><span>{c.args}</span><input value={options.arguments} disabled={locked} onChange={event=>setOptions({...options,arguments:event.target.value})} placeholder='-windowed'/></label>
     <div className="ga-group"><label className="ga-style-toggle"><input type="checkbox" tabIndex={-1} checked={admin} disabled={locked} onChange={event=>setAdmin(event.target.checked)}/>{c.admin}</label><p className="ga-hint">{c.adminHint}</p></div>
     <div className="ga-group"><label className="ga-style-toggle"><input type="checkbox" tabIndex={-1} checked={decompress} disabled={locked} onChange={event=>setDecompress(event.target.checked)}/>{c.decompress}</label><p className="ga-hint">{c.decompressHint}</p></div>
    </div>}]}/>
    {message?<p className="ga-status is-ok" role="status">{message}</p>:null}{error?<p className="ga-settings-error" role="alert">{error}</p>:null}
   </div>
   <footer><button type="button" disabled={locked} onClick={()=>void save()}>{c.save}</button></footer>
  </section>
 </div>;
}
