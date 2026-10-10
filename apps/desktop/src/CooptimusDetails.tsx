import {useEffect,useState} from "react";
import {invoke} from "@tauri-apps/api/core";
import {getApiBaseUrl} from "./settings";
import {hasTauriRuntime} from "./native";
import {useI18n} from "./i18n";
import {narrate} from "./narrationLog";
export type CoopDetails={app_id:number;state:string;local_players_max?:number;online_players_max?:number;lan_players_max?:number;combo_players_max?:number;coop_campaign?:boolean;coop_modes?:boolean;shared_split_screen?:boolean;drop_in_out?:boolean;source_url?:string;stale?:boolean};
const cache=new Map<number,{at:number;value:CoopDetails}>();
const pending=new Map<number,Promise<CoopDetails|null>>();
export async function loadCooptimusDetails(appId:number,name="",force=false):Promise<CoopDetails|null>{
 const previous=cache.get(appId);
 if(!force&&previous&&Date.now()-previous.at<(previous.value.state==="ready"?86400000:60000))return previous.value;
 const running=pending.get(appId);if(running)return running;
 const request=(async()=>{
  let value:CoopDetails|null=null;
  // The desktop browser can read the public detail directly; no catalog-wide scraping.
  if(hasTauriRuntime()&&name){
   try{value=await invoke<CoopDetails>("query_cooptimus",{appId,gameName:name});}
   catch{void narrate("Co-Optimus browser lookup failed for AppID "+appId,{area:"CATALOG",level:"WARN"});}
  }
  if(value?.state!=="ready"){
   try{const api=await getApiBaseUrl();if(api){const response=await fetch(api+"/library/games/"+appId+"/cooptimus?name="+encodeURIComponent(name)+(force?"&refresh=true":""),{signal:AbortSignal.timeout(18000)});if(response.ok)value=await response.json();}}
   catch{ /* Steam content remains visible when enrichment is offline. */ }
  }
  if(value?.app_id!==appId)value=null;
  if(value?.state!=="ready"&&previous?.value.state==="ready")value={...previous.value,stale:true};
  if(value)cache.set(appId,{at:Date.now(),value});
  void narrate("Co-Optimus game detail: AppID "+appId+" · "+(value?.state??"unavailable"),{area:"CATALOG"});
  return value;
 })().finally(()=>pending.delete(appId));pending.set(appId,request);return request;
}
export default function CooptimusDetails({appId,name="",enabled=true}:{appId:number|null;name?:string;enabled?:boolean}){
 const {locale}=useI18n();const es=locale==="es";const [data,setData]=useState<CoopDetails|null>(null);const [loading,setLoading]=useState(true);const [revision,setRevision]=useState(0);
 useEffect(()=>{setData(null);if(!enabled||!appId)return;let active=true;setLoading(true);void loadCooptimusDetails(appId,name,revision>0).then(value=>{if(active){setData(value);setLoading(false);}});return()=>{active=false;};},[appId,name,enabled,revision]);
 if(!enabled||!appId)return null;
 return <section className="ga-detail-coop" aria-label={es?"Juego cooperativo":"Co-op play"}>
  <div className="ga-detail-section-heading"><h3>{es?"Juego cooperativo":"Co-op play"}</h3><a href={data?.source_url?.startsWith("https://www.co-optimus.com/")?data.source_url:"https://www.co-optimus.com/games.php?system=4&game-title-filter="+encodeURIComponent(name)} target="_blank" rel="noreferrer">Co-Optimus ↗</a></div>
  {loading?<p role="status">{es?"Consultando detalles cooperativos…":"Loading co-op details…"}</p>:data?.state==="ready"?<>
   <CoopFacts data={data} es={es}/>
   {data.stale&&<small>{es?"Última consulta verificada; el sitio no respondió.":"Last verified result; site unavailable."}</small>}
  </>:<p role="status">{es?(data?.state==="unverified"?"No se encontró una ficha verificada para este juego.":"Co-Optimus no respondió. La información de Steam sigue disponible."):"Co-Optimus details unavailable. Steam information remains available."}</p>}
  {!loading&&<button className="ga-detail-text-action" type="button" onClick={()=>setRevision(v=>v+1)}>{es?"Volver a consultar":"Retry lookup"}</button>}
 </section>;
}

export function CoopFacts({data,es}:{data:CoopDetails;es:boolean}){
 const rows: Array<[string,number|undefined]>=[[es?"En el mismo equipo":"Couch co-op",data?.local_players_max],[es?"En línea":"Online co-op",data?.online_players_max],[es?"Red local":"LAN",data?.lan_players_max],[es?"Local + en línea":"Local + online",data?.combo_players_max]];

 return <>   <dl className="ga-coop-facts">{rows.filter(([,v])=>v!=null).map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value===0?(es?"No disponible":"Not supported"):value+" "+(es?"jugadores":"players")}</dd></div>)}</dl>
   <div className="ga-detail-tags">{[[data.coop_campaign,es?"Campaña cooperativa":"Co-op campaign"],[data.coop_modes,es?"Modos cooperativos":"Co-op modes"],[data.shared_split_screen,es?"Pantalla dividida":"Split screen"],[data.drop_in_out,es?"Entrada y salida libre":"Drop-in / drop-out"]].filter(([show])=>show).map(([,label])=><span key={String(label)}>{label}</span>)}</div></>;
}
