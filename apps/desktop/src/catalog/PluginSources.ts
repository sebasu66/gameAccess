import { recordNewDownloads } from "../newDownloads";
import type { ExecutionProfile } from "./ExecutionProfiles";
import { getPluginStatuses, pluginGeneration, providerAvailable } from "./PluginRuntime";
import { FlowDiagnostics } from "../FlowDiagnostics";
import { rankSources } from "./sourceRanking";
import { applySourceLessons, type GameLesson } from "./gameLessons";
import { getAppLocale, translate, type TranslationKey } from "../i18n";
import { narrate } from "../narrationLog";
import { invoke } from "@tauri-apps/api/core";
import type { CatalogGame } from "../types";
import {
  applyCatalogSources,
  removePluginCatalogSources,
  type SourceIndexEntry,
} from "../catalogCache";

export interface PluginManifest { id: string; name: string; endpoint: string; type: string; }
export interface PluginSource {
  title: string; url: string; type: string; size: string; score: number;
  pluginName: string; sourceName: string;
  executionProfile?: ExecutionProfile;
  resolverUrl?: string;
  delivery?: "browser" | "download";
  /** Same SHA-256 as the server's (sourceFingerprint.ts); what is reported and looked up instead of the address. */
  fingerprint?: string;
  /** Set when players learned to avoid this source (gameLessons.ts); such sources are listed last. */
  lesson?: GameLesson;
}
export interface SourceAvailability { count: number; names: string[]; }
export const SOURCES_CHANGED_EVENT = "gameaccess:sources-changed";
const REVISION_STORAGE_PREFIX = "gameaccess:plugin_source_revision:";
const detailSources = new Map<number, PluginSource[]>();
const appliedRevisions = new Map<string, string>();
const syncedSessionRevisions = new Map<string, string>();
const knownSourceNames = new Set<string>();
let pendingSync: Promise<Record<number, number>> | null = null;
const keyOf = (game: CatalogGame) => game.app_id ?? game.id;

function getSavedPluginRevision(pluginId: string): string {
  const inMem = appliedRevisions.get(pluginId);
  if (inMem !== undefined) return inMem;
  try {
    if (typeof localStorage !== "undefined") {
      const stored = localStorage.getItem(REVISION_STORAGE_PREFIX + pluginId);
      if (stored) {
        appliedRevisions.set(pluginId, stored);
        return stored;
      }
    }
  } catch { /* ignore storage errors */ }
  return "";
}

function setSavedPluginRevision(pluginId: string, revision: string): void {
  appliedRevisions.set(pluginId, revision);
  try {
    if (typeof localStorage !== "undefined") {
      if (revision) localStorage.setItem(REVISION_STORAGE_PREFIX + pluginId, revision);
      else localStorage.removeItem(REVISION_STORAGE_PREFIX + pluginId);
    }
  } catch { /* ignore storage errors */ }
}

export function setKnownSourceNames(names: Iterable<string>): void {
  for (const name of names) {
    if (typeof name === "string" && name.trim()) knownSourceNames.add(name.trim());
  }
}

export function sourceAvailability(game: CatalogGame): SourceAvailability {
  const id = keyOf(game);
  const detail = detailSources.get(id);
  if (detail && detail.length > 0) {
    return {
      count: detail.length,
      names: [...new Set(detail.map(source => source.sourceName).filter(Boolean))],
    };
  }
  const names = game.download_source_names ?? game.source_names ?? [];
  const count =
    game.availableSourceCount ??
    game.source_count ??
    (game.has_downloads ? Math.max(1, names.length) : names.length);
  return { count, names: [...names] };
}

export function applySourceAvailability(games: CatalogGame[]): CatalogGame[] {
  let changed = false;
  const next = games.map(game => {
    const entry = sourceAvailability(game);
    if (
      game.availableSourceCount === entry.count &&
      Boolean(game.has_downloads) === (entry.count > 0) &&
      JSON.stringify(game.download_source_names ?? []) === JSON.stringify(entry.names)
    ) {
      return game;
    }
    changed = true;
    return {
      ...game,
      has_downloads: entry.count > 0,
      availableSourceCount: entry.count,
      download_source_names: entry.names,
    };
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
/**
 * Whether a download-sources plugin is installed and has synced its index at least once. The plugin is optional
 * and installed by hand from its page; until then the game detail offers Play or "View on Steam" instead of a
 * download button (the synced sources stay usable while the plugin is closed).
 */
export async function sourcePluginReady(): Promise<boolean> {
  try {
    const registered = await invoke<PluginManifest[]>("get_registered_plugins");
    return registered.some(plugin => plugin.type === "source_provider" && getSavedPluginRevision(plugin.id) !== "");
  } catch {
    return false;
  }
}

function endpoint(plugin: PluginManifest, path: string): string {
  return plugin.endpoint.replace(/\/+$/, "") + path;
}
/** `scope: "game"` marks the result of one game's source discovery. Cards update
 * from it, but the catalog database answer is unchanged, so grids must not
 * query again (that re-ran the whole 1000-row query on every selection). */
function publish(scope: "all" | "game" = "all"): void {
  if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") window.dispatchEvent(new CustomEvent(SOURCES_CHANGED_EVENT, { detail: { scope } }));
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
      const params = new URLSearchParams({ app_id: String(keyOf(game)), name: game.name, lang: getAppLocale() });
      const response = await fetch(endpoint(plugin, "/api/sources?" + params), { signal: AbortSignal.timeout(14000) });
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
  // What other players learned comes last: a source marked as "not a game" never becomes the default choice.
  const sources = await applySourceLessons(rankSources(results.flat().filter(source => {
    if (seen.has(source.url)) return false;
    seen.add(source.url); return true;
  })), keyOf(game));
  const marked = sources.filter(source => source.lesson).length;
  if (marked) void narrate(`AppID ${keyOf(game)} · ${marked} source(s) moved last by what players learned (${sources.filter(source => source.lesson).map(source => source.lesson?.reason).join(", ")}).`, { area: "DOWNLOAD_SOURCES" });
  void narrate(`AppID ${keyOf(game)} · source discovery complete: ${sources.length} distinct option(s); download button ${sources.length ? "available" : "unavailable"}.`, { area: "DOWNLOAD_SOURCES" });
  if (sources.length > 0) {
    detailSources.set(keyOf(game), sources);
    for (const s of sources) {
      if (s.sourceName) knownSourceNames.add(s.sourceName);
    }
  } else {
    detailSources.delete(keyOf(game));
  }
  publish("game");
  return sources;
}
export function suggestedSource(game: CatalogGame): PluginSource | undefined {
  return detailSources.get(keyOf(game))?.[0];
}

export function invalidateCatalogMatchingCache(): void {
  // Matching is now persisted in SQLite via catalog_sources_apply.
}

export function getAllAvailableSourceNames(): string[] {
  const names = new Set<string>(knownSourceNames);
  for (const list of detailSources.values()) {
    for (const item of list) {
      if (item.sourceName) names.add(item.sourceName);
    }
  }
  return [...names].sort();
}

interface PluginSourceIndexResponse {
  revision?: unknown;
  full?: unknown;
  added?: unknown;
  removed?: unknown;
}

function normalizeIndexEntries(rawAdded: unknown, fallbackSourceName: string): SourceIndexEntry[] {
  if (!Array.isArray(rawAdded)) return [];
  const entries: SourceIndexEntry[] = [];
  for (const item of rawAdded) {
    if (!item || typeof item !== "object") continue;
    const obj = item as Record<string, unknown>;
    const title = typeof obj.title === "string" ? obj.title.trim() : typeof obj.raw_title === "string" ? obj.raw_title.trim() : "";
    if (!title) continue;
    const source = typeof obj.source === "string" && obj.source.trim()
      ? obj.source.trim()
      : typeof obj.source_name === "string" && obj.source_name.trim()
        ? obj.source_name.trim()
        : fallbackSourceName;
    entries.push({
      key: typeof obj.key === "string" && obj.key ? obj.key : undefined,
      title,
      source,
      multiplayer: Boolean(obj.multiplayer),
    });
  }
  return entries;
}

/** What a source sync is doing, for the central dialog: (detail, done, total). */
export type SourcesProgress = (detail: string, done?: number, total?: number) => void;

/** One log line saying what a plugin's source-index sync asked for, what it got and how long it took. */
export function pluginSyncLine(name: string, sync: { since: string; revision: string; full: boolean; added: number; removed: number; fetchedMs: number; totalMs: number;
  save?: { queued_ms?: number; wait_ms?: number; work_ms?: number } | null }): string {
  const save = sync.save ? ` (queued ${sync.save.queued_ms ?? "?"} ms, waiting for the catalog database ${sync.save.wait_ms ?? "?"} ms, writing ${sync.save.work_ms ?? "?"} ms)` : "";
  const asked = sync.since ? `changes since revision ${sync.since}` : "the full index";
  return `Provider '${name}' · source index: asked ${asked}, got ${sync.full ? "the full index" : "a delta"} → revision ${sync.revision} (+${sync.added} / -${sync.removed} entries); `
    + `request ${sync.fetchedMs} ms, saving ${sync.totalMs - sync.fetchedMs} ms${save}, total ${sync.totalMs} ms.`;
}

async function syncPluginIndex(plugin: PluginManifest, report: SourcesProgress = () => undefined): Promise<void> {
  const statuses = getPluginStatuses();
  const status = statuses.find(item => item.id === plugin.id && item.endpoint === plugin.endpoint);
  if (status && !status.alive) return;

  const lastRev = getSavedPluginRevision(plugin.id);
  const currentHealthRev = status?.revision ?? "";
  if (currentHealthRev && syncedSessionRevisions.get(plugin.id) === currentHealthRev && lastRev === currentHealthRev) {
    void narrate(`Provider '${plugin.name}' · source index already at revision ${lastRev}; nothing asked.`, { area: "DOWNLOAD_SOURCES" });
    return;
  }
  const started = Date.now();

  const fetchIndex = async (since: string): Promise<PluginSourceIndexResponse> => {
    const query = since ? `?since=${encodeURIComponent(since)}` : "";
    const response = await fetch(endpoint(plugin, `/api/source-index${query}`), {
      // The first, full index can hold tens of thousands of entries; a delta is small.
      signal: AbortSignal.timeout(since ? 15000 : 90000),
      cache: "no-store",
    });
    if (!response.ok) {
      void narrate(
        `Provider '${plugin.name}' · /api/source-index replied HTTP ${response.status}` +
          (response.status === 404 ? " (this plugin version has no source index; it must be updated)." : "."),
        { area: "DOWNLOAD_SOURCES", level: "WARN" },
      );
      // A plugin without the index (404) is an old version: the player has to update it, retrying will not help.
      throw new Error(translate(response.status === 404 ? "pluginTooOld" : "pluginIndexFailed", { name: plugin.name }));
    }
    return (await response.json()) as PluginSourceIndexResponse;
  };

  try {
    report(translate("pluginAsking", { name: plugin.name }));
    const payload = await fetchIndex(lastRev);
    const fetchedMs = Date.now() - started;

    let full = Boolean(payload.full);
    let added = normalizeIndexEntries(payload.added, plugin.name);
    let removed = Array.isArray(payload.removed)
      ? payload.removed.filter((k): k is string => typeof k === "string" && k.length > 0)
      : [];
    let revision = String(payload.revision ?? (currentHealthRev || "1"));

    for (const entry of added) {
      if (entry.source) knownSourceNames.add(entry.source);
    }

    report(translate("pluginSaving", { name: plugin.name }), 0, added.length + removed.length);
    let applied = await applyCatalogSources({
      pluginId: plugin.id,
      revision,
      full,
      added,
      removed,
    });
    report(translate("pluginSaving", { name: plugin.name }), added.length + removed.length, added.length + removed.length);

    // If a delta was requested with a stored revision from a previous DB, but the local DB has 0 sources,
    // re-fetch full index once so the DB is populated.
    if (!full && lastRev && applied && applied.sources_total === 0) {
      const fullPayload = await fetchIndex("");
      full = true;
      added = normalizeIndexEntries(fullPayload.added, plugin.name);
      removed = [];
      revision = String(fullPayload.revision ?? revision);
      for (const entry of added) {
        if (entry.source) knownSourceNames.add(entry.source);
      }
      applied = await applyCatalogSources({
        pluginId: plugin.id,
        revision,
        full: true,
        added,
        removed: [],
      });
    }

    setSavedPluginRevision(plugin.id, revision);
    syncedSessionRevisions.set(plugin.id, currentHealthRev || revision);
    void narrate(pluginSyncLine(plugin.name, { since: lastRev, revision, full, added: added.length, removed: removed.length, fetchedMs, totalMs: Date.now() - started, save: applied }),
      { area: "DOWNLOAD_SOURCES" });
    if (applied?.new_downloads?.length) recordNewDownloads(applied.new_downloads, "plugin");
    if (full || added.length > 0 || removed.length > 0) {
      publish();
    }
  } catch (error) {
    void narrate(
      `Provider '${plugin.name}' · source-index sync failed: ${error instanceof Error ? error.message : "unknown error"}.`,
      { area: "DOWNLOAD_SOURCES", level: "WARN" },
    );
    // The player has to know: without the index the plugin's games show no downloads.
    if (error instanceof Error && error.name !== "TypeError" && error.name !== "TimeoutError") throw error;
    throw new Error(translate("pluginIndexFailed", { name: plugin.name }));
  }
}

export async function checkPluginSources(_games?: CatalogGame[], report?: SourcesProgress): Promise<Record<number, number>> {
  if (pendingSync) return pendingSync;
  const run = (async () => {
    const manifests = await plugins();
    // Each plugin syncs on its own; one that fails does not hold back the others, and the failure is reported.
    const results = await Promise.allSettled(manifests.map(plugin => syncPluginIndex(plugin, report)));
    const failure = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
    if (failure) throw failure.reason;
    return {};
  })().finally(() => {
    pendingSync = null;
  });
  pendingSync = run;
  return run;
}

export const syncPluginSources = checkPluginSources;

export async function unregisterPluginSources(pluginId: string): Promise<void> {
  setSavedPluginRevision(pluginId, "");
  syncedSessionRevisions.delete(pluginId);
  await removePluginCatalogSources(pluginId).catch(err => {
    void narrate(`Failed to remove catalog sources for plugin '${pluginId}': ${String(err)}`, {
      area: "DOWNLOAD_SOURCES",
      level: "WARN",
    });
  });
  publish();
}

/** Resolve only the chosen option through its own registered provider. */
export async function preparePluginSource(source: PluginSource): Promise<PluginSource> {
  if (!source.resolverUrl) return source;
  void narrate("Preparing selected source '" + source.sourceName + "' · " + source.title + ".", { area: "DOWNLOAD_SOURCES" });
  const diagnostics = new FlowDiagnostics("source-resolution", "DOWNLOAD_SOURCES");
  diagnostics.debug(`provider=${source.pluginName} source=${source.sourceName} resolver started`);
  try {
  const response = await fetch(withLanguage(source.resolverUrl), { signal: AbortSignal.timeout(60000) });
  diagnostics.debug(`Resolver HTTP=${response.status}`);
  const result = await response.json() as { url?: unknown; error?: unknown; mode?: unknown; executionProfile?: ExecutionProfile };
  if (!response.ok || !validUrl(result.url)) {
    throw new Error(pluginErrorText(result));
  }
  void narrate("Selected source prepared by plugin; delivery=" + String(result.mode ?? "direct") + ".", { area: "DOWNLOAD_SOURCES" });
  diagnostics.succeed();
  return { ...source, executionProfile: result.executionProfile ?? source.executionProfile, url: result.url.trim(), delivery: result.mode === "browser" ? "browser" : source.delivery };
  } catch (error) {
    diagnostics.fail(error);
    throw error;
  } finally { diagnostics.discard(); }
}

/** The plugin answers in the language sent with the request; the app keeps its own catalog for known codes. */
function withLanguage(url: string): string {
  const parsed = new URL(url);
  parsed.searchParams.set("lang", getAppLocale());
  return parsed.toString();
}

function pluginErrorText(body: { code?: unknown; error?: unknown }): string {
  const known: Record<string, TranslationKey> = {
    sourceGone: "pluginErrorSourceGone",
    sourceUnavailable: "pluginErrorSourceUnavailable",
    browserOnly: "pluginErrorBrowserOnly",
  };
  if (typeof body.code === "string" && known[body.code]) return translate(known[body.code]);
  return typeof body.error === "string" ? body.error : translate("pluginPrepareFailed");
}

export function invalidatePluginSources(): void {
  detailSources.clear();
  syncedSessionRevisions.clear();
  appliedRevisions.clear();
  knownSourceNames.clear();
  try {
    if (typeof localStorage !== "undefined") {
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const key = localStorage.key(i);
        if (key && key.startsWith(REVISION_STORAGE_PREFIX)) {
          localStorage.removeItem(key);
        }
      }
    }
  } catch { /* ignore storage errors */ }
  publish();
}
