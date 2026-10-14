import type { ExecutionProfile } from "./ExecutionProfiles";
import { pluginGeneration, providerAvailable } from "./PluginRuntime";
import { FlowDiagnostics } from "../FlowDiagnostics";
import { narrate } from "../narrationLog";
import { invoke } from "@tauri-apps/api/core";
import type { CatalogGame } from "../types";
import { gamesWithPossibleSources } from "./sourceTitleIndex";
import { setCatalogTempSources, type TempSourceItem, readCatalogCache } from "../catalogCache";

export interface PluginManifest { id: string; name: string; endpoint: string; type: string; }
export interface PluginSource {
  title: string; url: string; type: string; size: string; score: number;
  pluginName: string; sourceName: string;
  executionProfile?: ExecutionProfile;
  resolverUrl?: string;
  delivery?: "browser" | "download";
}
export interface SourceAvailability { count: number; names: string[]; }
export const SOURCES_CHANGED_EVENT = "gameaccess:sources-changed";
const availability = new Map<number, SourceAvailability>();
const detailSources = new Map<number, PluginSource[]>();
const pending = new Map<string, Promise<Record<number, number>>>();
const completedScans = new Map<string, number>();
const SCAN_CACHE_MS = 5 * 60 * 1000;
const keyOf = (game: CatalogGame) => game.app_id ?? game.id;

export function sourceAvailability(game: CatalogGame): SourceAvailability {
  return availability.get(keyOf(game)) ?? { count: 0, names: [] };
}
export function applySourceAvailability(games: CatalogGame[]): CatalogGame[] {
  let changed = false;
  const next = games.map(game => {
    const entry = sourceAvailability(game);
    if (game.availableSourceCount === entry.count && JSON.stringify(game.download_source_names) === JSON.stringify(entry.names)) return game;
    changed = true;
    return { ...game, has_downloads: entry.count > 0, availableSourceCount: entry.count, download_source_names: entry.names };
  });
  return changed ? next : games;
}
async function plugins(): Promise<PluginManifest[]> {
  try {
    const result = await invoke<PluginManifest[]>("get_registered_plugins");
    return result.filter(plugin => plugin.type === "source_provider" && /^https?:\/\//.test(plugin.endpoint) && providerAvailable(plugin));
  } catch (error) {
    void narrate(`Plugin registry unavailable: ${error instanceof Error ? error.name : "unknown error"}.`, { area: "DOWNLOAD_SOURCES", level: "WARN" });
    return [];
  }
}
function endpoint(plugin: PluginManifest, path: string): string {
  return plugin.endpoint.replace(/\/+$/, "") + path;
}
function publish(): void {
  if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") window.dispatchEvent(new Event(SOURCES_CHANGED_EVENT));
}
function validUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const uri = value.trim().replace(/&amp;/gi, "&");
  if (/^magnet:/i.test(uri)) {
    const topics = new URLSearchParams(uri.slice(uri.indexOf("?") + 1)).getAll("xt");
    return topics.some(topic => /^urn:btih:(?:[a-f0-9]{40}|[a-z2-7]{32})$/i.test(topic) || /^urn:btmh:1220[a-f0-9]{64}$/i.test(topic));
  }
  try { return ["http:", "https:"].includes(new URL(uri).protocol); } catch { return false; }
}
function normalizeSource(value: unknown, plugin: PluginManifest): PluginSource[] {
  if (!value || typeof value !== "object") return [];
  const item = value as Record<string, unknown>;
  if (!validUrl(item.url)) return [];
  let resolverUrl: string | undefined;
  if (typeof item.resolverUrl === "string") {
    try {
      const parsed = new URL(item.resolverUrl);
      if (parsed.origin === new URL(plugin.endpoint).origin) resolverUrl = parsed.href;
    } catch { /* Invalid provider metadata. */ }
  }
  return [{
    resolverUrl, delivery: item.delivery === "browser" ? "browser" : "download",
    title: typeof item.title === "string" ? item.title : plugin.name,
    url: item.url.trim(), type: typeof item.type === "string" ? item.type : "http",
    size: typeof item.size === "string" ? item.size : "",
    score: typeof item.score === "number" && Number.isFinite(item.score) ? item.score : 0,
    pluginName: plugin.name, sourceName: typeof item.sourceName === "string" ? item.sourceName : plugin.name,
  }];
}
export async function getPluginSources(game: CatalogGame): Promise<PluginSource[]> {
  const epoch = pluginGeneration();
  const manifests = await plugins();
  void narrate(`AppID ${keyOf(game)} · source discovery started for '${game.name}' with ${manifests.length} registered provider(s).`, { area: "DOWNLOAD_SOURCES" });
  const results = await Promise.all(manifests.map(async plugin => {
    const diagnostics = new FlowDiagnostics(`source-discovery app_id=${keyOf(game)}`, "DOWNLOAD_SOURCES");
    diagnostics.debug(`provider=${plugin.id} generation=${epoch} request started`);
    try {
      const params = new URLSearchParams({ app_id: String(keyOf(game)), name: game.name });
      const response = await fetch(endpoint(plugin, "/api/sources?" + params), { signal: AbortSignal.timeout(8000) });
      diagnostics.debug(`provider=${plugin.id} HTTP=${response.status}`);
      if (!response.ok) {
        diagnostics.fail(`Provider HTTP ${response.status}`);
        void narrate(`AppID ${keyOf(game)} · provider '${plugin.name}' replied HTTP ${response.status}.`, { area: "DOWNLOAD_SOURCES", level: "WARN" });
        return [];
      }
      const data: unknown = await response.json();
      const received = Array.isArray(data) ? data.flatMap(value => normalizeSource(value, plugin)) : [];
      void narrate(`AppID ${keyOf(game)} · provider '${plugin.name}' returned ${received.length} usable option(s).`, { area: "DOWNLOAD_SOURCES" });
      return received;
    } catch (error) {
      diagnostics.fail(error);
      void narrate(`AppID ${keyOf(game)} · provider '${plugin.name}' source request failed: ${error instanceof Error ? error.name : "unknown error"}.`, { area: "DOWNLOAD_SOURCES", level: "WARN" });
      return [];
    } finally { diagnostics.discard(); }
  }));
  if (epoch !== pluginGeneration()) return [];
  const seen = new Set<string>();
  const sources = results.flat().filter(source => {
    if (seen.has(source.url)) return false;
    seen.add(source.url); return true;
  });
  void narrate(`AppID ${keyOf(game)} · source discovery complete: ${sources.length} distinct option(s); download button ${sources.length ? "available" : "unavailable"}.`, { area: "DOWNLOAD_SOURCES" });
  detailSources.set(keyOf(game), sources);
  availability.set(keyOf(game), { count: sources.length, names: [...new Set(sources.map(source => source.sourceName))] });
  publish();
  return sources;
}
export function suggestedSource(game: CatalogGame): PluginSource | undefined {
  return detailSources.get(keyOf(game))?.[0];
}
let matchingCatalog: CatalogGame[] | null = null;

export function invalidateCatalogMatchingCache(): void {
  matchingCatalog = null;
}

async function getMatchingCatalog(): Promise<CatalogGame[]> {
  if (matchingCatalog && matchingCatalog.length > 0) return matchingCatalog;
  matchingCatalog = await readCatalogCache().catch(() => []);
  return matchingCatalog;
}

export function getAllAvailableSourceNames(): string[] {
  const names = new Set<string>();
  for (const entry of availability.values()) {
    for (const name of entry.names) names.add(name);
  }
  return [...names].sort();
}

export async function checkPluginSources(games?: CatalogGame[]): Promise<Record<number, number>> {
  const candidateGames = (games && games.length) ? games : await getMatchingCatalog();
  const key = pluginGeneration() + ":" + (games && games.length ? JSON.stringify(games.map(game => [keyOf(game), game.name])) : "all");
  if (Date.now() - (completedScans.get(key) ?? 0) < SCAN_CACHE_MS) {
    return Object.fromEntries(candidateGames.map(game => [keyOf(game), sourceAvailability(game).count]));
  }
  const existing = pending.get(key);
  if (existing) return existing;
  const request = check(candidateGames, key).finally(() => pending.delete(key));
  pending.set(key, request);
  return request;
}
function bulkAvailability(raw: unknown, providerName: string): SourceAvailability {
  const object = raw && typeof raw === "object" ? raw as {count?: unknown; sources?: unknown} : {};
  const value = typeof raw === "number" ? raw : object.count;
  const count = typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
  if (!count) return {count:0,names:[]};
  const names = Array.isArray(object.sources) ? object.sources.filter((name): name is string => typeof name === "string") : [];
  return {count,names:names.length ? names : [providerName]};
}

function applyBulkBatch(batch: CatalogGame[], data: Record<string, unknown>, next: Map<number, SourceAvailability>, providerName: string): void {
  for (const game of batch) {
    const received = bulkAvailability(data[String(keyOf(game))], providerName);
    const entry = next.get(keyOf(game))!;
    entry.count += received.count;
    entry.names.push(...received.names);
    availability.set(keyOf(game), { count: entry.count, names: [...new Set(entry.names)] });
  }
}

/** Asks the provider for the titles it has sources for (a few thousand). Null when it cannot tell. */
async function providerTitles(plugin: PluginManifest): Promise<string[] | null> {
  try {
    const response = await fetch(endpoint(plugin, "/api/titles"), { signal: AbortSignal.timeout(10000) });
    if (!response.ok) return null;
    const data = await response.json() as unknown;
    return Array.isArray(data) ? data.filter((title): title is string => typeof title === "string") : null;
  } catch { return null; }
}

async function check(games: CatalogGame[], scanKey: string): Promise<Record<number, number>> {
  let hadErrors = false;
  let lastPublished = 0;
  const epoch = pluginGeneration();
  const next = new Map<number, SourceAvailability>(games.map(game => [keyOf(game), { count: 0, names: [] }]));
  const manifests = await plugins();
  void narrate(`Source availability scan started: ${games.length} game(s), ${manifests.length} provider(s), batches of 100.`, { area: "DOWNLOAD_SOURCES" });
  if (epoch !== pluginGeneration()) return {};
  for (const [id, entry] of next) availability.set(id, entry);
  publish();
  await Promise.all(manifests.map(async plugin => {
    // Start from the provider's own list of titles and look those up in the catalog, instead of
    // asking about every catalog game. Providers without /api/titles are scanned game by game.
    const titles = await providerTitles(plugin);
    const toScan = titles ? gamesWithPossibleSources(titles, games) : games;
    if (titles) void narrate(`Provider '${plugin.name}' lists ${titles.length} source title(s); ${toScan.length} of ${games.length} catalog game(s) may match.`, { area: "DOWNLOAD_SOURCES" });
    for (let start = 0; start < toScan.length; start += 100) {
      if (epoch !== pluginGeneration()) return;
      const batch = toScan.slice(start, start + 100);
      try {
        const response = await fetch(endpoint(plugin, "/api/bulk_check"), {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ include_sources: true, games: batch.map(game => ({ id: keyOf(game), name: game.name })) }),
          signal: AbortSignal.timeout(15000),
        });
        if (!response.ok) {
          hadErrors = true;
          void narrate(`Provider '${plugin.name}' · source batch ${start / 100 + 1} failed: HTTP ${response.status}.`, { area: "DOWNLOAD_SOURCES", level: "WARN" });
          continue;
        }
        const data = await response.json() as Record<string, unknown>;
        if (epoch !== pluginGeneration()) return;
        applyBulkBatch(batch, data, next, plugin.name);
        if (games.length <= 500 || Date.now() - lastPublished >= 1000) {
          lastPublished = Date.now(); publish();
        }
      } catch (error) {
        hadErrors = true;
        void narrate(`Provider '${plugin.name}' · source batch ${start / 100 + 1} failed: ${error instanceof Error ? error.name : "unknown error"}.`, { area: "DOWNLOAD_SOURCES", level: "WARN" });
      }
    }
  }));
  if (epoch !== pluginGeneration()) return {};
  for (const [id, entry] of next) availability.set(id, {count:entry.count,names:[...new Set(entry.names)]});
  void narrate(`Source availability scan finished: ${[...next.values()].filter(entry => entry.count > 0).length} game(s) with sources.`, { area: "DOWNLOAD_SOURCES" });
  const tempSources: TempSourceItem[] = [];
  for (const [id, entry] of next) {
    if (entry.count > 0 && entry.names.length > 0) {
      tempSources.push({ app_id: id, source_names: [...new Set(entry.names)] });
    }
  }
  await setCatalogTempSources(tempSources).catch(err => {
    void narrate(`Failed to set catalog temp sources: ${String(err)}`, { area: "DOWNLOAD_SOURCES", level: "WARN" });
  });
  publish();
  if (!hadErrors) {
    completedScans.set(scanKey, Date.now());
    if (completedScans.size > 4) completedScans.delete(completedScans.keys().next().value!);
  }
  return Object.fromEntries([...next].map(([id, entry]) => [id, entry.count]));
}

/** Resolve only the chosen option through its own registered provider. */
export async function preparePluginSource(source: PluginSource): Promise<PluginSource> {
  if (!source.resolverUrl) return source;
  void narrate("Preparing selected source '" + source.sourceName + "' · " + source.title + ".", { area: "DOWNLOAD_SOURCES" });
  const diagnostics = new FlowDiagnostics("source-resolution", "DOWNLOAD_SOURCES");
  diagnostics.debug(`provider=${source.pluginName} source=${source.sourceName} resolver started`);
  try {
  const response = await fetch(source.resolverUrl, { signal: AbortSignal.timeout(60000) });
  diagnostics.debug(`Resolver HTTP=${response.status}`);
  const result = await response.json() as { url?: unknown; error?: unknown; mode?: unknown; executionProfile?: ExecutionProfile };
  if (!response.ok || !validUrl(result.url)) {
    throw new Error(typeof result.error === "string" ? result.error : "El plugin no pudo preparar el enlace de descarga.");
  }
  void narrate("Selected source prepared by plugin; delivery=" + String(result.mode ?? "direct") + ".", { area: "DOWNLOAD_SOURCES" });
  diagnostics.succeed();
  return { ...source, executionProfile: result.executionProfile ?? source.executionProfile, url: result.url.trim(), delivery: result.mode === "browser" ? "browser" : source.delivery };
  } catch (error) {
    diagnostics.fail(error);
    throw error;
  } finally { diagnostics.discard(); }
}

export function invalidatePluginSources(): void {
  availability.clear();
  completedScans.clear();
  detailSources.clear();
  void setCatalogTempSources([]).catch(() => {});
  publish();
}
