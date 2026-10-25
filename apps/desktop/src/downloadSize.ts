import {getAppLocale,translate,type AppLocale} from "./i18n";
import type {CatalogGame} from "./types";
export function formatDownloadBytes(value?: number, locale: AppLocale = getAppLocale()): string {
  if(value == null || !Number.isFinite(value)) return "—";
  const units=["B","KB","MB","GB","TB"];
  let size=Math.max(0,value),index=0;
  while(size>=1024 && index<units.length-1){size/=1024;index++;}
  return `${size.toLocaleString(locale==="es"?"es-AR":"en-US",{maximumFractionDigits:index?1:0})} ${units[index]}`;
}
export function sourceDownloadSize(game:CatalogGame,locale:AppLocale=getAppLocale()):string|null {
  if(game.download_size_bytes != null && Number.isFinite(game.download_size_bytes) && game.download_size_bytes>0) return formatDownloadBytes(game.download_size_bytes,locale);
  return game.download_size?.trim() || null;
}
/** Bytes from a size as sources write it ("12.4 GB", "850 MB", "1,5 GiB"); undefined when it cannot be read. */
export function parseDownloadSize(text?: string|null):number|undefined {
  const match=/(\d+(?:[.,]\d+)?)\s*([KMGT])i?B\b/i.exec(text ?? "");
  if(!match) return undefined;
  const value=Number(match[1].replace(",","."));
  return Number.isFinite(value) && value>0 ? Math.round(value*1024**("KMGT".indexOf(match[2].toUpperCase())+1)) : undefined;
}
export function downloadButtonLabel(game:CatalogGame,locale:AppLocale=getAppLocale()):string {
  const label=translate("downloadAction",undefined,locale),size=sourceDownloadSize(game,locale);
  return size ? `${label} (${size})` : label;
}
