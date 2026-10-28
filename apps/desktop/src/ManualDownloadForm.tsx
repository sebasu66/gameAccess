import {useState} from "react";
import {digitalCatalogService} from "./catalog/DigitalCatalog";
import {parseExecutionProfile, type ExecutionProfile} from "./catalog/ExecutionProfiles";
import {narrate} from "./narrationLog";
import type {CatalogGame} from "./types";
import {useI18n} from "./i18n";
import GamePicker from "./GamePicker";
import "./operations.css";
export default function ManualDownloadForm({game,onDone}:{game?:CatalogGame;onDone?:()=>void}) {
 const {locale,t}=useI18n(); const es=locale==="es";
 // Which game it is must be known: chosen from the catalog, never invented (a made-up AppID left two copies of one game).
 const [picked,setPicked]=useState<CatalogGame|null>(null); const [url,setUrl]=useState("");
 const [size,setSize]=useState(""); const [passwords,setPasswords]=useState("");
 const [profile,setProfile]=useState<ExecutionProfile|null>(null); const [error,setError]=useState(""); const [busy,setBusy]=useState(false);
 const submit=async(event:React.FormEvent)=>{
  event.preventDefault();setError("");
  try {
   let uri=url.trim().replace(/&amp;/gi,"&");
   if(/^magnet:/i.test(uri))uri="magnet:"+uri.slice(uri.indexOf(":")+1);
   const valid=uri.toLowerCase().startsWith("magnet:?")
     ? new URLSearchParams(uri.slice(uri.indexOf("?")+1)).getAll("xt").some(t=>/^urn:btih:(?:[a-f0-9]{40}|[a-z2-7]{32})$/i.test(t)||/^urn:btmh:1220[a-f0-9]{64}$/i.test(t))
     : ["http:","https:"].includes(new URL(uri).protocol);
   if(!valid)throw Error(es?"Introduce un enlace HTTP/HTTPS o magnet válido.":"Enter a valid HTTP/HTTPS link or magnet.");
   const target=game??picked;
   if(!target)throw Error(t("manualPickGame"));
   const id=target.app_id??target.id;
   setBusy(true);
   const executionProfile=parseExecutionProfile({...profile,id:profile?.id??"manual",origin:"manual",archivePasswords:[...new Set([...(profile?.archivePasswords??[]),...passwords.split(/\r?\n/).map(p=>p.trim()).filter(Boolean)])]});
   await digitalCatalogService.download(target,{url:uri,title:target.name,type:uri.startsWith("magnet:")?"torrent":"http",size,score:0,pluginName:"Manual",sourceName:"Manual",delivery:"download",executionProfile});
   void narrate("AppID "+id+" · manual download added; optional profile="+Boolean(profile),{area:"DOWNLOAD"});
   onDone?.();
  }catch(e){setError(e instanceof Error?e.message:String(e));}finally{setBusy(false);}
 };
 return <form className="manual-download-form" onSubmit={event=>void submit(event)}>
  {!game&&<GamePicker label={es?"Juego":"Game"} value={picked} onChange={setPicked}/>}
  <label>{es?"Enlace de descarga o magnet":"Download link or magnet"}<input required autoComplete="off" value={url} onChange={e=>setUrl(e.target.value)}/></label>
  <details><summary>{es?"Opciones avanzadas":"Advanced options"}</summary>
   <label>{es?"Tamaño (opcional)":"Size (optional)"}<input placeholder="12 GB" value={size} onChange={e=>setSize(e.target.value)}/></label>
   <label>{es?"Contraseñas de archivos (una por línea)":"Archive passwords (one per line)"}<textarea value={passwords} onChange={e=>setPasswords(e.target.value)} spellCheck={false}/></label>
   <label>{es?"Perfil de ejecución JSON (opcional)":"Execution profile JSON (optional)"}<input type="file" accept=".json,application/json" onChange={async e=>{const file=e.target.files?.[0];if(!file)return;try{setProfile(parseExecutionProfile(JSON.parse(await file.text())));setError("");}catch(err){setError(String(err));}}}/></label>
   {profile&&<p>{profile.name??profile.id??(es?"Perfil cargado":"Profile loaded")} · {profile.beforePlay.length} {es?"pasos":"steps"}</p>}
  </details>
  {error&&<p role="alert">{error}</p>}
  <button type="submit" disabled={busy||(!game&&!picked)}>{busy?(es?"Preparando…":"Preparing…"):(es?"Añadir descarga":"Add download")}</button>
 </form>;
}
