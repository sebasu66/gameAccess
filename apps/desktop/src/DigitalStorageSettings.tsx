import { GaButton } from "./components/ga/Buttons";
import { useEffect, useState } from "react";
import { useI18n } from "./i18n";
import { localizeLauncherText } from "./launcherText";
import { digitalProcessManager, type DigitalStorageSettings as StorageSettings } from "./catalog/DigitalProcessManager";
import { digitalDownloadService } from "./catalog/DigitalDownloadService";
import { clearGameLibrary } from "./libraryActions";
import { useLibraryBusy, useLibraryGames } from "./libraryMembership";
import AppDialog from "./AppDialog";
import { Button } from "./components/ui/button";
import { Checkbox } from "./components/ui/checkbox";
import { Input } from "./components/ui/input";
const copy = {
 es:{title:"Descargas y juegos",deleteSources:"Borrar archivos de descarga al terminar",deleteHint:"Elimina los comprimidos e instaladores ya usados. Se conserva el archivo de fix declarado.",games:"Carpeta de juegos",temporary:"Descargas temporales",hint:"Las rutas nuevas se usan para futuras descargas. Los juegos existentes conservan su ubicación.",save:"Guardar rutas",saved:"Rutas guardadas.",library:"Biblioteca",clear:"Vaciar biblioteca",confirm:"¿Vaciar toda la biblioteca?",warning:"Se quitarán todos los juegos de tu biblioteca y se desinstalarán sus archivos locales. Esta acción no se puede deshacer.",cancel:"Volver",blocked:"Detén las descargas antes de cambiar rutas o vaciar la biblioteca.",done:"Biblioteca vaciada.",unavailable:"Las rutas se configuran en el cliente de escritorio.",count:"Juegos en la biblioteca",autoFreeze:"Congelar los juegos que no uso",autoFreezeHint:"Al mes sin jugar, el juego se comprime con la compresión de Windows y se sigue jugando igual. A los tres meses pasa a congelado profundo: ocupa menos y se descongela solo al jugar. Nunca toca juegos vinculados."},
 en:{title:"Downloads and games",deleteSources:"Delete download files when finished",deleteHint:"Removes archives and installers already used. The declared fix archive is kept.",games:"Game folder",temporary:"Temporary downloads",hint:"New paths apply to future downloads. Existing games keep their location.",save:"Save paths",saved:"Paths saved.",library:"Library",clear:"Clear library",confirm:"Clear the entire library?",warning:"All games will be removed from your library and their local files uninstalled. This cannot be undone.",cancel:"Back",blocked:"Stop downloads before changing paths or clearing the library.",done:"Library cleared.",unavailable:"Paths are configured in the desktop client.",count:"Games in library",autoFreeze:"Freeze the games I do not play",autoFreezeHint:"After a month without playing, the game is compressed with Windows compression and still plays the same. After three months it is deep frozen: it takes less space and thaws on its own when played. Linked games are never touched."},
};
export default function DigitalStorageSettings(){
 const {locale}=useI18n();const c=copy[locale];
 const [settings,setSettings]=useState<StorageSettings|null>(null);
 const [pending,setPending]=useState(false);const [message,setMessage]=useState("");const [error,setError]=useState("");
 const [confirm,setConfirm]=useState(false);
 // A long games folder, or one with accents or symbols, can keep games from running (the launcher says why).
 const [rootWarning,setRootWarning]=useState("");
 const [active,setActive]=useState(()=>digitalDownloadService.hasActiveDownloads());
 const members=useLibraryGames();const libraryBusy=useLibraryBusy();
 const native=typeof window!=="undefined"&&"__TAURI_INTERNALS__" in window;
 useEffect(()=>digitalDownloadService.onGlobalUpdate(()=>setActive(digitalDownloadService.hasActiveDownloads())),[]);
 useEffect(()=>{if(!native)return;let live=true;void digitalProcessManager.settings().then(result=>{if(live){setSettings(result.settings??null);setRootWarning(localizeLauncherText(result.games_root_warning??""));}}).catch(error=>{if(live)setError(String(error));});return()=>{live=false;};},[native]);
 const save=async()=>{if(!settings)return;setPending(true);setError("");setMessage("");
   try{if(digitalDownloadService.hasActiveDownloads())throw new Error(c.blocked);const result=await digitalProcessManager.saveSettings(settings);setSettings(result.settings??settings);setRootWarning(localizeLauncherText(result.games_root_warning??""));setMessage(c.saved);}
   catch(error){setError(String(error));}finally{setPending(false);}
 };
 // Saved at once (it changes no folder, so it does not wait for "Save paths").
 const saveAutoFreeze=async(value:boolean)=>{if(!settings)return;setError("");
   try{const result=await digitalProcessManager.saveSettings({...settings,auto_freeze:value});setSettings(result.settings??{...settings,auto_freeze:value});}
   catch(error){setError(String(error));}
 };
 const clear=async()=>{setPending(true);setError("");setMessage("");
   try{await clearGameLibrary();setMessage(c.done);}catch(error){setError(String(error));}finally{setPending(false);setConfirm(false);}
 };
 const locked=pending||active||libraryBusy;
 const field=(id:string,label:string,value:string,onChange:(value:string)=>void)=><div className="grid gap-2"><label htmlFor={id} className="text-sm font-semibold">{label}</label><Input id={id} disabled={locked||!settings} value={value} onChange={event=>onChange(event.target.value)}/></div>;
 return <section className="ga-storage-settings grid gap-5">
  <h3 className="m-0 text-base font-bold">{c.title}</h3>{native?<>
   {field("ga-games-root",c.games,settings?.games_root??"",value=>settings&&setSettings({...settings,games_root:value}))}
   {rootWarning?<p role="status" className="ga-root-warning m-0 text-sm text-amber-300">{rootWarning}</p>:null}
   {field("ga-temp-root",c.temporary,settings?.temporary_root??"",value=>settings&&setSettings({...settings,temporary_root:value}))}
   <div className="flex items-start gap-3 rounded-lg border border-border bg-card/50 p-4">
    <Checkbox id="ga-delete-sources" className="mt-0.5" disabled={locked||!settings} checked={settings?.delete_download_sources??true} onCheckedChange={value=>settings&&setSettings({...settings,delete_download_sources:value===true})}/>
    <div className="grid gap-1"><label htmlFor="ga-delete-sources" className="text-sm font-semibold">{c.deleteSources}</label><p className="m-0 text-sm text-muted-foreground">{c.deleteHint}</p></div>
   </div>
   <div className="flex items-start gap-3 rounded-lg border border-border bg-card/50 p-4">
    <Checkbox id="ga-auto-freeze" className="mt-0.5" disabled={pending||!settings} checked={settings?.auto_freeze??false} onCheckedChange={value=>void saveAutoFreeze(value===true)}/>
    <div className="grid gap-1"><label htmlFor="ga-auto-freeze" className="text-sm font-semibold">{c.autoFreeze}</label><p className="m-0 text-sm text-muted-foreground">{c.autoFreezeHint}</p></div>
   </div>
   <p className="m-0 text-sm text-muted-foreground">{c.hint}</p>
   <div><GaButton variant="primary" disabled={locked||!settings} onClick={()=>void save()}>{c.save}</GaButton></div>
  </>:<p className="m-0 text-sm text-muted-foreground">{c.unavailable}</p>}
  <details className="ga-settings-group rounded-lg border border-border bg-card/50 p-4"><summary className="cursor-pointer text-sm font-bold">{c.library}</summary><div className="mt-3 flex items-center justify-between gap-4"><p className="m-0 text-sm text-muted-foreground">{c.count}: {members.length}</p><Button variant="destructive" disabled={locked||!members.length} onClick={()=>setConfirm(true)}>{c.clear}</Button></div></details>
  {active?<p role="status" className="m-0 text-sm text-muted-foreground">{c.blocked}</p>:null}{message?<p role="status" className="m-0 text-sm text-success">{message}</p>:null}{error?<p className="ga-settings-error m-0 text-sm" role="alert">{error}</p>:null}
  {confirm?<AppDialog title={c.confirm} message={c.warning} tone="warning" onClose={()=>{if(!pending)setConfirm(false);}} onConfirm={()=>void clear()} confirmLabel={c.clear} cancelLabel={c.cancel} confirmDisabled={locked} cancelDisabled={pending}/>:null}
 </section>;
}
