import { GaButton, GaClose } from "./components/ga/Buttons";
import { useEffect, useState } from "react";
import { getSteamStoreLanguage, useI18n } from "./i18n";
import { useDialogFocus } from "./dialogFocus";
import GaTabs from "./GaTabs";
import { emptyAutomation, loadAutomation, saveAutomation, type AutomationFields } from "./catalog/ExecutionProfiles";
import { digitalProcessManager, type DigitalLaunchOptions } from "./catalog/DigitalProcessManager";
import type { CatalogGame } from "./types";
const copy = {
 es: {title:"Idioma y ejecución",language:"Idioma del juego",repair:"Buscar y reparar idioma",hint:"Busca ajustes de idioma en archivos INI y conserva una copia original. El juego necesita incluir ese idioma.",tabLanguage:"Idioma",tabLaunch:"Ejecución",keep:"No cambiar el idioma del juego",keepHint:"El juego queda con el idioma que trae. Si GameAccess lo había cambiado, al jugar vuelve al original.",exe:"Archivo ejecutable",automatic:"Detectar automáticamente",args:"Argumentos de lanzamiento",admin:"Ejecutar como administrador",adminHint:"Windows pedirá autorización al jugar.",decompress:"Descomprimir el fix en cada ejecución",decompressHint:"Antes de jugar, el fix o crack se vuelve a descomprimir sobre el juego, por si el antivirus borró archivos.",save:"Guardar opciones",close:"Cerrar",saved:"Opciones guardadas.",repaired:"Archivos corregidos",none:"No se encontraron ajustes de idioma que cambiar.",backup:"La restauración de respaldos y los ajustes automáticos siguen activos.",loading:"Leyendo archivos del juego…",spanish:"Español",english:"Inglés",portuguese:"Portugués",french:"Francés",german:"Alemán",appLanguage:"Idioma de la aplicación",
  linkedTitle:"Ejecución",linkedHint:"Es un juego vinculado: Game Access lo ejecuta desde su carpeta y no cambia sus archivos.",command:"Comando de ejecución",commandHint:"Si queda vacío se usa el de siempre:",commandReset:"Usar el de siempre",
  helpIntro:"Cada línea es un paso y se ejecutan en orden. Con «wait 5» se esperan 5 segundos entre un paso y el siguiente. Las líneas que empiezan con # son notas. ID es el número del juego en Steam.",
  help:[
   {title:"1. Cerrar la sesión de Steam",lines:[[String.raw`"C:\Program Files (x86)\Steam\steam.exe" -shutdown`,"Cierra Steam con la cuenta que tenga abierta. Antes del paso siguiente se espera a que Steam termine de cerrarse."]]},
   {title:"2. Entrar con otra cuenta",lines:[[String.raw`"C:\Program Files (x86)\Steam\steam.exe" -login USUARIO CONTRASEÑA`,"Abre Steam con esa cuenta. Si Steam pide el código de Steam Guard, hay que escribirlo en Steam. La contraseña queda guardada en esta PC (nunca en los registros)."],["wait 15","Le da tiempo a Steam para terminar de entrar antes de abrir el juego."]]},
   {title:"3. Ejecutar el juego",lines:[["steam://rungameid/ID","Lo abre Steam, como sus accesos directos. Es el de siempre para los juegos de Steam."],["steam://run/ID//-dx11 -windowed/","Lo abre Steam con argumentos (van entre las dos barras dobles y la final)."],[String.raw`"C:\Program Files (x86)\Steam\steam.exe" -applaunch ID -dx11`,"Steam desde la terminal, con argumentos."],[String.raw`"D:\Juegos\Cyberpunk 2077\bin\x64\Cyberpunk2077.exe"`,"El ejecutable del juego directo, sin Steam: sirve para los juegos cuyo launcher no necesita Steam abierto ni verifica la licencia (Cyberpunk 2077, por ejemplo). En ese caso no hacen falta los pasos 1 y 2."]]},
  ],
  helpNote:"Después de cambiar el comando, usá «Verificar que corre» para probarlo."},
 en: {title:"Language and launch",language:"Game language",repair:"Find and repair language",hint:"Finds language settings in INI files and keeps an original backup. The game must include that language.",tabLanguage:"Language",tabLaunch:"Launch",keep:"Don't change the game's language",keepHint:"The game keeps the language it ships with. If GameAccess had changed it, it goes back to the original when you play.",exe:"Executable file",automatic:"Detect automatically",args:"Launch arguments",admin:"Run as administrator",adminHint:"Windows will ask for permission when you play.",decompress:"Extract the fix on every launch",decompressHint:"Before playing, the fix or crack is extracted over the game again, in case antivirus deleted files.",save:"Save options",close:"Close",saved:"Options saved.",repaired:"Files repaired",none:"No language settings needed changing.",backup:"Archive restoration and automatic fixes remain active.",loading:"Reading game files…",spanish:"Spanish",english:"English",portuguese:"Portuguese",french:"French",german:"German",appLanguage:"App language",
  linkedTitle:"Launch",linkedHint:"A linked game: Game Access runs it from its folder and does not change its files.",command:"Launch command",commandHint:"When empty, the usual one is used:",commandReset:"Use the usual one",
  helpIntro:"Each line is a step and they run in order. “wait 5” waits 5 seconds between one step and the next. Lines starting with # are notes. ID is the game's number on Steam.",
  help:[
   {title:"1. Sign out of Steam",lines:[[String.raw`"C:\Program Files (x86)\Steam\steam.exe" -shutdown`,"Closes Steam with whatever account is open. The next step waits until Steam has really closed."]]},
   {title:"2. Sign in with another account",lines:[[String.raw`"C:\Program Files (x86)\Steam\steam.exe" -login USER PASSWORD`,"Opens Steam with that account. If Steam asks for the Steam Guard code, type it in Steam. The password stays saved on this PC (never in the logs)."],["wait 15","Gives Steam time to finish signing in before the game opens."]]},
   {title:"3. Run the game",lines:[["steam://rungameid/ID","Steam opens it, as its desktop shortcuts. The usual one for Steam games."],["steam://run/ID//-dx11 -windowed/","Steam opens it with arguments (between the double slashes and the last one)."],[String.raw`"C:\Program Files (x86)\Steam\steam.exe" -applaunch ID -dx11`,"Steam from a terminal, with arguments."],[String.raw`"D:\Games\Cyberpunk 2077\bin\x64\Cyberpunk2077.exe"`,"The game's own executable, without Steam: for games whose launcher needs neither Steam open nor a license check (Cyberpunk 2077, say). Then steps 1 and 2 are not needed."]]},
  ],
  helpNote:"After changing the command, use “Check that it runs” to try it."},
};
export default function DigitalGameOptions({game,onClose,disabled=false}:{game:CatalogGame;onClose:()=>void;disabled?:boolean}) {
 const {locale}=useI18n(); const c=copy[locale];
 const ref=useDialogFocus(onClose);
 const [options,setOptions]=useState<DigitalLaunchOptions>({executable:"",arguments:"",administrator:false,language:""});
 const [executables,setExecutables]=useState<string[]>([]);
 const [automation,setAutomation]=useState<AutomationFields>(emptyAutomation);
 const [loading,setLoading]=useState(true); const [busy,setBusy]=useState(false);
 const [message,setMessage]=useState(""); const [error,setError]=useState("");
 // A Steam game is started by its launch command (its steps: sign out, sign in, run). A game linked from a folder has
 // the launch options of any game (executable, arguments, administrator) but no language or fix: its files are not changed.
 const [linked,setLinked]=useState<{command:string;usual:string}|null>(null);
 const [folderLink,setFolderLink]=useState(false);
 useEffect(()=>{let live=true; void digitalProcessManager.gameOptions(game).then(result=>{
   if(live&&result.linked&&result.kind==="folder"){setFolderLink(true);if(result.options)setOptions(result.options);setExecutables(result.executables??[]);return;}
   if(live&&result.linked){setLinked({command:result.command??"",usual:result.default_command??""});return;}
   if(live){if(result.options) setOptions(result.options);setExecutables(result.executables??[]);}
   return loadAutomation(game.app_id??game.id).then(found=>{if(live)setAutomation(found);});
 }).catch(error=>{if(live)setError(String(error));}).finally(()=>{if(live)setLoading(false);});return()=>{live=false;};},[game.app_id,game.id]);
 const save=async(repair=false)=>{
   setBusy(true);setError("");setMessage("");
   try {
     if(linked){const result=await digitalProcessManager.saveLaunchCommand(game,linked.command);
       if(result.error) throw new Error(result.error);
       setLinked({command:result.command??"",usual:result.default_command??linked.usual});setMessage(c.saved);return;}
     if(folderLink){const result=await digitalProcessManager.saveGameOptions(game,options);
       if(result.error) throw new Error(result.error);
       if(result.options) setOptions(result.options);setMessage(c.saved);return;}
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
 const admin=options.administrator||(!folderLink&&automation.runAsAdmin);
 const setAdmin=(on:boolean)=>{setOptions({...options,administrator:on});setAutomation({...automation,runAsAdmin:on});};
 const launchFields=<>
  <label className="ga-path-control"><span>{c.exe}</span><select value={options.executable} disabled={locked} onChange={event=>setOptions({...options,executable:event.target.value})}><option value="">{c.automatic}</option>{options.executable&&!executables.includes(options.executable)?<option value={options.executable}>{options.executable}</option>:null}{executables.map(executable=><option key={executable} value={executable}>{executable}</option>)}</select></label>
  <label className="ga-path-control"><span>{c.args}</span><input value={options.arguments} disabled={locked} onChange={event=>setOptions({...options,arguments:event.target.value})} placeholder='-windowed'/></label>
  <div className="ga-group"><label className="ga-style-toggle"><input type="checkbox" tabIndex={-1} checked={admin} disabled={locked} onChange={event=>setAdmin(event.target.checked)}/>{c.admin}</label><p className="ga-hint">{c.adminHint}</p></div>
 </>;
 return <div className="ga-settings-backdrop" onPointerDown={event=>event.stopPropagation()} onClick={event=>{if(event.target===event.currentTarget&&!busy)onClose();}}>
  <section ref={ref} className="ga-settings-panel ga-game-config" role="dialog" aria-modal="true" aria-labelledby="game-config-title">
   <header><div><span className="eyebrow">{game.name}</span><h2 id="game-config-title">{linked||folderLink?c.linkedTitle:c.title}</h2></div><GaClose label={c.close} onClick={onClose} disabled={busy} data-dialog-initial /></header>
   <div className="ga-settings-content">
    {loading?<p className="ga-status" role="status">{c.loading}</p>:null}
    {folderLink?<div className="ga-stack">{launchFields}<p className="ga-hint">{c.linkedHint}</p></div>
    :linked?<div className="ga-stack">
     <div className="ga-path-control"><label htmlFor="game-command">{c.command}</label>
      <textarea id="game-command" rows={4} value={linked.command} disabled={locked} spellCheck={false} placeholder={linked.usual} aria-describedby="game-command-help" onChange={event=>setLinked({...linked,command:event.target.value})}/></div>
     {/* The help is always there, folded in three steps (sign out, sign in, run): one opens at a time, so the dialog grows by one. */}
     <div id="game-command-help" className="ga-command-help ga-stack"><p className="ga-hint">{c.helpIntro}</p>
      <div className="ga-command-steps">{c.help.map(section=><details key={section.title} className="ga-command-step ga-disclosure"><summary>{section.title}</summary>
       <dl>{section.lines.map(([form,why])=><div key={form}><dt><code>{form}</code></dt><dd>{why}</dd></div>)}</dl></details>)}</div>
      <p className="ga-hint">{c.helpNote}</p></div>
     {linked.usual?<p className="ga-hint">{c.commandHint} <code>{linked.usual}</code></p>:null}
     {linked.command?<GaButton disabled={locked} onClick={()=>setLinked({...linked,command:""})}>{c.commandReset}</GaButton>:null}
    </div>:<GaTabs label={c.title} tabs={[{id:"language",label:c.tabLanguage,content:<div className="ga-stack">
     <label className="ga-path-control"><span>{c.language}</span><select value={options.language} disabled={locked} onChange={event=>setOptions({...options,language:event.target.value})}>
      <option value="">{c.appLanguage} ({c[getSteamStoreLanguage()]})</option><option value="keep">{c.keep}</option>
      {(["spanish","english","portuguese","french","german"] as const).map(language=><option key={language} value={language}>{c[language]}</option>)}</select></label>
     <p className="ga-hint">{keep?c.keepHint:c.hint}</p>
     {keep?null:<GaButton disabled={locked} onClick={()=>void save(true)}>{c.repair}</GaButton>}
    </div>},{id:"launch",label:c.tabLaunch,content:<div className="ga-stack">
     {launchFields}
     <div className="ga-group"><label className="ga-style-toggle"><input type="checkbox" tabIndex={-1} checked={decompress} disabled={locked} onChange={event=>setDecompress(event.target.checked)}/>{c.decompress}</label><p className="ga-hint">{c.decompressHint}</p></div>
    </div>}]}/>}
    {message?<p className="ga-status is-ok" role="status">{message}</p>:null}{error?<p className="ga-settings-error" role="alert">{error}</p>:null}
   </div>
   <footer><button type="button" disabled={locked} onClick={()=>void save()}>{c.save}</button></footer>
  </section>
 </div>;
}
