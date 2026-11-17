import { useEffect, useState } from "react";
import { narrate } from "./narrationLog";
interface Poster { appId: number; dataUrl: string; savedAt: number; priority: number }
export const MAX_MEDIA_POSTERS = 120;
const memory = new Map<number, Poster>();
const listeners = new Set<(appId: number) => void>();
let database: Promise<IDBDatabase | null> | undefined;
function openDatabase() {
  database ??= new Promise(resolve => {
    if (typeof indexedDB === "undefined") { resolve(null); return; }
    const request = indexedDB.open("gameaccess-media-posters", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("posters", { keyPath: "appId" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
  });
  return database;
}
function remember(poster: Poster) {
  memory.delete(poster.appId); memory.set(poster.appId, poster);
  if (memory.size > MAX_MEDIA_POSTERS) memory.delete(memory.keys().next().value!);
}
export function mediaPosterSize(width: number, height: number) {
  const scale = Math.min(1, 480 / width, 270 / height);
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}
export async function readMediaPoster(appId: number): Promise<string | null> {
  if (memory.has(appId)) return memory.get(appId)!.dataUrl;
  const db = await openDatabase();
  if (!db) return null;
  return new Promise(resolve => {
    const request = db.transaction("posters").objectStore("posters").get(appId);
    request.onsuccess = () => {
      const poster = request.result as Poster | undefined;
      if (poster?.appId === appId && poster.dataUrl.startsWith("data:image/")) { remember(poster); resolve(poster.dataUrl); }
      else resolve(null);
    };
    request.onerror = () => resolve(null);
  });
}
async function persist(poster: Poster) {
  const db = await openDatabase(); if (!db) return;
  const transaction = db.transaction("posters", "readwrite");
  const store = transaction.objectStore("posters"); store.put(poster);
  const all = store.getAll();
  all.onsuccess = () => {
    const entries = (all.result as Poster[]).sort((a,b) => b.savedAt-a.savedAt);
    for (const old of entries.slice(MAX_MEDIA_POSTERS)) store.delete(old.appId);
  };
  transaction.oncomplete = () => { void narrate(`Cached media poster for AppID ${poster.appId}: ${Math.ceil(poster.dataUrl.length * .75 / 1024)} KB.`, {area:"MEDIA"}); };
}
export function cacheMediaPoster(appId: number | null | undefined, source: CanvasImageSource, width: number, height: number, priority = 0) {
  if (!appId || !width || !height) return;
  const existing = memory.get(appId);
  if (existing && existing.priority >= priority && Date.now()-existing.savedAt < 86400000) return;
  try {
    const canvas=document.createElement("canvas"); const size=mediaPosterSize(width,height); canvas.width=size.width; canvas.height=size.height;
    const context=canvas.getContext("2d"); if (!context) return;
    context.drawImage(source,0,0,size.width,size.height);
    const dataUrl=canvas.toDataURL("image/webp",.55); if (dataUrl.length>100000) return;
    const poster={appId,dataUrl,savedAt:Date.now(),priority}; remember(poster); void persist(poster).catch(()=>undefined);
    for(const listener of listeners) listener(appId);
  } catch { /* A cross-origin frame may be unreadable; keep the existing poster. */ }
}
export function cacheMediaImage(appId: number | null | undefined, url: string | undefined): () => void {
  if (!appId || !url || url.startsWith("data:") || memory.has(appId)) return () => undefined;
  const image=new Image(); image.crossOrigin="anonymous";
  image.onload=()=>cacheMediaPoster(appId,image,image.naturalWidth,image.naturalHeight);
  image.src=url;
  return () => { image.onload=null; image.src=""; };
}
export function useMediaPoster(appId: number | null | undefined) {
  const [poster,setPoster]=useState<string | undefined>(()=>appId ? memory.get(appId)?.dataUrl : undefined);
  useEffect(()=>{
    if (!appId) return; let cancelled=false;
    void readMediaPoster(appId).then(value=>{if(!cancelled && value) { setPoster(value); void narrate(`Loaded local media poster for AppID ${appId}.`,{area:"MEDIA"}); }});
    const refresh=(id:number)=>{if(id===appId)setPoster(memory.get(id)?.dataUrl);}; listeners.add(refresh);
    return ()=>{cancelled=true;listeners.delete(refresh);};
  },[appId]);
  return poster;
}
