/**
 * How a download is really being fetched, shown as a small pill on the downloads screen. The launcher reports it
 * (`route` in its status) once it has chosen; before that the pill shows the best guess from the source and plan.
 *
 * - measuring:   PLUS is measuring the torrent to decide whether to download it directly or through the server
 * - torrent:     the player's own torrent client
 * - accelerated: our server prepares it (torrent bridge, then a file host) and the player downloads it in pieces
 * - direct:      an HTTP link downloaded straight from its host
 */
import { translate, type AppLocale, type TranslationKey } from "./i18n";
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

// The services behind the acceleration are never named: the player only reads "torrent acceleration service".
const LABELS: Record<DownloadMethod, { label: TranslationKey; hint: TranslationKey }> = {
  measuring: { label: "dlMethodMeasuring", hint: "dlMethodMeasuringHint" },
  torrent: { label: "dlMethodTorrent", hint: "dlMethodTorrentHint" },
  accelerated: { label: "dlMethodAccelerated", hint: "dlMethodAcceleratedHint" },
  direct: { label: "dlMethodDirect", hint: "dlMethodDirectHint" },
};

const localeOf = (locale: string): AppLocale => locale === "es" ? "es" : "en";

export function downloadMethodLabel(method: DownloadMethod, locale: string): { label: string; hint: string } {
  return { label: translate(LABELS[method].label, undefined, localeOf(locale)), hint: translate(LABELS[method].hint, undefined, localeOf(locale)) };
}

/** The plan pill: PLUS downloads can be accelerated, BASE ones never are. */
export function planLabel(tier: "base" | "plus", locale: string): { label: string; hint: string } {
  return tier === "plus"
    ? { label: "PLUS", hint: translate("dlPlanPlusHint", undefined, localeOf(locale)) }
    : { label: "BASE", hint: translate("dlPlanBaseHint", undefined, localeOf(locale)) };
}
