/**
 * How a download is really being fetched, shown as a small pill on the downloads screen. The launcher reports it
 * (`route` in its status) once it has chosen; before that the pill shows the best guess from the source and plan.
 *
 * - measuring:   PLUS is measuring the torrent to decide whether to download it directly or through the server
 * - torrent:     the player's own torrent client
 * - accelerated: our server prepares it (TorBox -> Viking Files) and the player downloads it in pieces
 * - direct:      an HTTP link downloaded straight from its host
 */
export type DownloadMethod = "measuring" | "torrent" | "accelerated" | "direct";

function isTorrent(source: string): boolean {
  const value = source.trim().toLowerCase();
  return value.startsWith("magnet:") || /\.torrent(?:$|\?)/.test(value);
}

/** The pill before the launcher reports: with PLUS a torrent is measured first and a link goes through the server. */
export function initialDownloadMethod(source: string, accelerated: boolean): DownloadMethod {
  if (isTorrent(source)) return accelerated ? "measuring" : "torrent";
  return accelerated ? "accelerated" : "direct";
}

/** The launcher's `route` field, or undefined when it has not chosen yet (or is an older launcher). */
export function methodFromRoute(route: unknown): DownloadMethod | undefined {
  return route === "measuring" || route === "torrent" || route === "accelerated" || route === "direct" ? route : undefined;
}

const LABELS: Record<DownloadMethod, { es: string; en: string; hint: { es: string; en: string } }> = {
  measuring: { es: "Eligiendo ruta", en: "Choosing route", hint: { es: "Midiendo el torrent para decidir si conviene bajarlo directo o acelerado por el servidor", en: "Measuring the torrent to decide whether to download it directly or accelerated by the server" } },
  torrent: { es: "Torrent directo", en: "Direct torrent", hint: { es: "Se descarga por torrent directamente en tu equipo", en: "Downloaded by torrent straight to this computer" } },
  accelerated: { es: "Acelerada · Viking", en: "Accelerated · Viking", hint: { es: "Nuestro servidor la prepara (Torbox → Viking Files) y tu equipo la baja en piezas", en: "Our server prepares it (TorBox → Viking Files) and this computer downloads it in pieces" } },
  direct: { es: "Descarga directa", en: "Direct download", hint: { es: "Se descarga directamente desde el enlace original", en: "Downloaded straight from the original link" } },
};

export function downloadMethodLabel(method: DownloadMethod, locale: string): { label: string; hint: string } {
  const lang = locale === "es" ? "es" : "en";
  return { label: LABELS[method][lang], hint: LABELS[method].hint[lang] };
}

/** The plan pill: PLUS downloads can be accelerated by the server, BASE ones never use it. */
export function planLabel(tier: "base" | "plus", locale: string): { label: string; hint: string } {
  const es = locale === "es";
  return tier === "plus"
    ? { label: "PLUS", hint: es ? "Hasta 4 descargas a la vez; las lentas se aceleran por el servidor" : "Up to 4 downloads at once; slow ones are accelerated by the server" }
    : { label: "BASE", hint: es ? "1 descarga a la vez, por torrent o enlace directo" : "1 download at a time, by torrent or direct link" };
}
