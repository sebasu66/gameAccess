/** How a download is actually being fetched, shown as a small pill on the downloads screen. */
export type DownloadMethod = "viking" | "torrent" | "direct";

export function downloadMethodFor(source: string, serverMode?: "cache" | "processed" | "direct" | null): DownloadMethod {
  if (serverMode === "cache" || serverMode === "processed") return "viking";
  const value = source.trim().toLowerCase();
  return value.startsWith("magnet:") || /\.torrent(?:$|\?)/.test(value) ? "torrent" : "direct";
}

const LABELS: Record<DownloadMethod, { es: string; en: string; hint: { es: string; en: string } }> = {
  viking: { es: "Viking Files", en: "Viking Files", hint: { es: "Descarga acelerada desde la caché del servidor", en: "Accelerated download from the server cache" } },
  torrent: { es: "Torrent local", en: "Local torrent", hint: { es: "Se descarga por torrent directamente en tu equipo", en: "Downloaded by torrent straight to this computer" } },
  direct: { es: "Descarga directa", en: "Direct download", hint: { es: "Se descarga directamente desde el enlace original", en: "Downloaded straight from the original link" } },
};

export function downloadMethodLabel(method: DownloadMethod, locale: string): { label: string; hint: string } {
  const lang = locale === "es" ? "es" : "en";
  return { label: LABELS[method][lang], hint: LABELS[method].hint[lang] };
}
