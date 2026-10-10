import { useEffect, useState } from "react";
import { useI18n } from "./i18n";
import { digitalProcessManager, type DigitalStorageSettings as StorageSettings } from "./catalog/DigitalProcessManager";
import { digitalDownloadService } from "./catalog/DigitalDownloadService";
import { clearGameLibrary } from "./libraryActions";
import { useLibraryBusy, useLibraryGames } from "./libraryMembership";
import AppDialog from "./AppDialog";
const copy = {
 es:{title:"Descargas y juegos",games:"Carpeta de juegos",temporary:"Descargas temporales",hint:"Las rutas nuevas se usan para futuras descargas. Los juegos existentes conservan su ubicación.",save:"Guardar rutas",saved:"Rutas guardadas.",library:"Biblioteca",clear:"Vaciar biblioteca",confirm:"¿Vaciar toda la biblioteca?",warning:"Se quitarán todos los juegos de tu biblioteca y se desinstalarán sus archivos locales. Esta acción no se puede deshacer.",cancel:"Volver",blocked:"Detén las descargas antes de cambiar rutas o vaciar la biblioteca.",done:"Biblioteca vaciada.",unavailable:"Las rutas se configuran en el cliente de escritorio.",count:"Juegos en la biblioteca"},
 en:{title:"Downloads and games",games:"Game folder",temporary:"Temporary downloads",hint:"New paths apply to future downloads. Existing games keep their location.",save:"Save paths",saved:"Paths saved.",library:"Library",clear:"Clear library",confirm:"Clear the entire library?",warning:"All games will be removed from your library and their local files uninstalled. This cannot be undone.",cancel:"Back",blocked:"Stop downloads before changing paths or clearing the library.",done:"Library cleared.",unavailable:"Paths are configured in the desktop client.",count:"Games in library"},
};
export default function DigitalStorageSettings(){
 const {locale}=useI18n();const c=copy[locale];
 const [settings,setSettings]=useState<StorageSettings|null>(null);
 const [pending,setPending]=useState(false);const [message,setMessage]=useState("");const [error,setError]=useState("");
 const [confirm,setConfirm]=useState(false);
 const [active,setActive]=useState(()=>digitalDownloadService.hasActiveDownloads());
 const members=useLibraryGames();const libraryBusy=useLibraryBusy();
 const native=typeof window!=="undefined"&&"__TAURI_INTERNALS__" in window;
 useEffect(()=>digitalDownloadService.onGlobalUpdate(()=>setActive(digitalDownloadService.hasActiveDownloads())),[]);
 useEffect(()=>{if(!native)return;let live=true;void digitalProcessManager.settings().then(result=>{if(live)setSettings(result.settings??null);}).catch(error=>{if(live)setError(String(error));});return()=>{live=false;};},[native]);
 const save=async()=>{if(!settings)return;setPending(true);setError("");setMessage("");
   try{if(digitalDownloadService.hasActiveDownloads())throw new Error(c.blocked);const result=await digitalProcessManager.saveSettings(settings);setSettings(result.settings??settings);setMessage(c.saved);}
   catch(error){setError(String(error));}finally{setPending(false);}
 };
 const clear=async()=>{setPending(true);setError("");setMessage("");
   try{await clearGameLibrary();setMessage(c.done);}catch(error){setError(String(error));}finally{setPending(false);setConfirm(false);}
 };
 const locked=pending||active||libraryBusy;
 return <section className="ga-storage-settings">
  <h3>{c.title}</h3>{native?<>
   <label className="ga-path-control"><span>{c.games}</span><input disabled={locked||!settings} value={settings?.games_root??""} onChange={event=>settings&&setSettings({...settings,games_root:event.target.value})}/></label>
   <label className="ga-path-control"><span>{c.temporary}</span><input disabled={locked||!settings} value={settings?.temporary_root??""} onChange={event=>settings&&setSettings({...settings,temporary_root:event.target.value})}/></label>
   <p>{c.hint}</p><button type="button" disabled={locked||!settings} onClick={()=>void save()}>{c.save}</button>
  </>:<p>{c.unavailable}</p>}
  <details className="ga-settings-group"><summary>{c.library}</summary><p>{c.count}: {members.length}</p><button type="button" className="ga-danger-option" disabled={locked||!members.length} onClick={()=>setConfirm(true)}>{c.clear}</button></details>
  {active?<p role="status">{c.blocked}</p>:null}{message?<p role="status">{message}</p>:null}{error?<p className="ga-settings-error" role="alert">{error}</p>:null}
  {confirm?<AppDialog title={c.confirm} message={c.warning} tone="warning" onClose={()=>{if(!pending)setConfirm(false);}} onConfirm={()=>void clear()} confirmLabel={c.clear} cancelLabel={c.cancel} confirmDisabled={locked} cancelDisabled={pending}/>:null}
 </section>;
}
