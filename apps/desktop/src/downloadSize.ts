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
export function downloadButtonLabel(game:CatalogGame,locale:AppLocale=getAppLocale()):string {
  const label=translate("downloadAction",undefined,locale),size=sourceDownloadSize(game,locale);
  return size ? `${label} (${size})` : label;
}
