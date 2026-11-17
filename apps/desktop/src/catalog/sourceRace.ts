/**
 * The race between torrents of a game at the start of a download (Seba, 2026-11-11), the app's part: which sources
 * may race, the player's optional choice at the start of the download wizard (a word or version the title must
 * have, a provider), and the server's answer on which race (`POST /downloads/race-plan`). The launcher runs the race
 * (game_download_manager/source_race.py). Without the server's answer there is no race and the first source is used.
 */
import { activationHeaders } from "../activation";
import { narrate } from "../narrationLog";
import { getApiBaseUrl } from "../settings";
import type { PluginSource } from "./PluginSources";
import { isPartialSource } from "./sourceRanking";

/** What the player may ask of the source at the start of the wizard; empty means fully automatic. */
export interface SourcePreference {
  /** Words or numbers the title must contain, all of them ("v1.2", "GOG"). */
  words?: string[];
  /** The provider (the source's or the plugin's name), as listed. */
  provider?: string;
}

/** The race the launcher runs: the racers (best first) and the rules the server set for the player's plan. */
export interface RaceOrder {
  racers: { source: string; title: string; provider: string }[];
  decideAfter?: number;
  giveUpAfter?: number;
  lead?: number;
  metadataTimeout?: number;
}

const MAX_PREPARED = 6;   // sources prepared to find the racers (each may ask its plugin's resolver)
const PREPARE_TIMEOUT_MS = 20000;

const fold = (text: string) => text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function sourceProvider(source: Pick<PluginSource, "sourceName" | "pluginName">): string {
  return source.sourceName || source.pluginName;
}

/** Whether a source meets what the player asked (case and accents do not matter). */
export function matchesPreference(source: PluginSource, preference?: SourcePreference): boolean {
  if (!preference) return true;
  const title = fold(source.title);
  const words = (preference.words ?? []).map(word => fold(word.trim())).filter(Boolean);
  if (words.some(word => !title.includes(word))) return false;
  return !preference.provider || fold(sourceProvider(source)) === fold(preference.provider);
}

export function hasPreference(preference?: SourcePreference): boolean {
  return Boolean(preference && ((preference.words ?? []).some(word => word.trim()) || preference.provider));
}

/** The sources that may race, in ranking order: not marked bad, not opened in a browser, not a patch alone. */
export function raceCandidates(listed: PluginSource[], preference?: SourcePreference): PluginSource[] {
  const partial = isPartialSource(listed);
  return listed.filter(source => !source.lesson && source.delivery !== "browser" && !partial(source) && matchesPreference(source, preference));
}

const BASE32 = "abcdefghijklmnopqrstuvwxyz234567";

/** The torrent's info-hash (40 lowercase hex) in a magnet link, or null. */
export function magnetInfoHash(url: string): string | null {
  if (!/^magnet:\?/i.test(url)) return null;
  const found = url.match(/xt=urn:btih:([0-9a-z]+)/i);
  if (!found) return null;
  const code = found[1].toLowerCase();
  if (/^[0-9a-f]{40}$/.test(code)) return code;
  if (code.length !== 32) return null;
  let bits = "";
  for (const char of code) {
    const value = BASE32.indexOf(char);
    if (value < 0) return null;
    bits += value.toString(2).padStart(5, "0");
  }
  return Array.from({ length: 20 }, (_, i) => parseInt(bits.slice(i * 8, i * 8 + 8), 2).toString(16).padStart(2, "0")).join("");
}

const isTorrent = (url: string) => /^magnet:\?/i.test(url) || /\.torrent(?:$|[?#])/i.test(url);

type Prepare = (source: PluginSource) => Promise<PluginSource>;
type ServerPlan = Omit<Partial<RaceOrder>, "racers"> & { racers?: { index: number }[] };
type AskServer = (candidates: { index: number; hash: string | null }[]) => Promise<ServerPlan>;

async function askServer(candidates: { index: number; hash: string | null }[]): Promise<ServerPlan> {
  const response = await fetch(`${await getApiBaseUrl()}/downloads/race-plan`, {
    method: "POST", headers: { "Content-Type": "application/json", ...activationHeaders() },
    body: JSON.stringify({ candidates }), signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error(`race-plan HTTP ${response.status}`);
  return response.json();
}

/**
 * The race for this download, or undefined (no race: the first source goes on alone). `first` is the source already
 * prepared for the download; the other candidates are prepared at the same time, and only torrents race.
 */
export async function planRace(first: PluginSource, candidates: PluginSource[], prepare: Prepare, ask: AskServer = askServer): Promise<RaceOrder | undefined> {
  const others = candidates.filter(source => source.url !== first.url && source !== first).slice(0, MAX_PREPARED - 1);
  if (!others.length || !isTorrent(first.url)) return undefined;
  const timeout = <T,>(work: Promise<T>) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("timeout")), PREPARE_TIMEOUT_MS); });
    return Promise.race([work, late]).finally(() => clearTimeout(timer));
  };
  const prepared = await Promise.allSettled(others.map(source => timeout(prepare(source))));
  const pool = [first, ...prepared.flatMap(result => result.status === "fulfilled" && result.value.delivery !== "browser" && isTorrent(result.value.url) ? [result.value] : [])];
  const unique = pool.filter((source, index) => pool.findIndex(other => other.url === source.url
    || (magnetInfoHash(other.url) !== null && magnetInfoHash(other.url) === magnetInfoHash(source.url))) === index);
  if (unique.length < 2) return undefined;
  try {
    const plan = await ask(unique.map((source, index) => ({ index, hash: magnetInfoHash(source.url) })));
    const racers = (plan.racers ?? []).map(racer => unique[racer.index]).filter(Boolean);
    if (racers.length < 2) return undefined;
    void narrate(`Carrera entre ${racers.length} torrents: ${racers.map(source => source.title).join(" · ")}`, { area: "DOWNLOAD_SOURCES" });
    return {
      racers: racers.map(source => ({ source: source.url, title: source.title, provider: sourceProvider(source) })),
      decideAfter: plan.decideAfter, giveUpAfter: plan.giveUpAfter, lead: plan.lead, metadataTimeout: plan.metadataTimeout,
    };
  } catch (error) {
    void narrate(`Sin carrera de fuentes (${String(error)}); se usa la primera.`, { area: "DOWNLOAD_SOURCES", level: "WARN" });
    return undefined;
  }
}
