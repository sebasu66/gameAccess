import type { ExecutionProfile } from "./ExecutionProfiles";
import { getPluginStatuses, pluginGeneration, providerAvailable } from "./PluginRuntime";
import { FlowDiagnostics } from "../FlowDiagnostics";
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
  if (sources.length > 0) {
    detailSources.set(keyOf(game), sources);
    for (const s of sources) {
      if (s.sourceName) knownSourceNames.add(s.sourceName);
    }
  } else {
    detailSources.delete(keyOf(game));
  }
  publish();
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

async function syncPluginIndex(plugin: PluginManifest): Promise<void> {
  const statuses = getPluginStatuses();
  const status = statuses.find(item => item.id === plugin.id && item.endpoint === plugin.endpoint);
  if (status && !status.alive) return;

  const lastRev = getSavedPluginRevision(plugin.id);
  const currentHealthRev = status?.revision ?? "";
  if (currentHealthRev && syncedSessionRevisions.get(plugin.id) === currentHealthRev && lastRev === currentHealthRev) {
    return;
  }

  const fetchIndex = async (since: string): Promise<PluginSourceIndexResponse | null> => {
    const query = since ? `?since=${encodeURIComponent(since)}` : "";
    const response = await fetch(endpoint(plugin, `/api/source-index${query}`), {
      signal: AbortSignal.timeout(15000),
      cache: "no-store",
    });
    if (!response.ok) return null;
    return (await response.json()) as PluginSourceIndexResponse;
  };

  try {
    let payload = await fetchIndex(lastRev);
    if (!payload) return;

    let full = Boolean(payload.full);
    let added = normalizeIndexEntries(payload.added, plugin.name);
    let removed = Array.isArray(payload.removed)
      ? payload.removed.filter((k): k is string => typeof k === "string" && k.length > 0)
      : [];
    let revision = String(payload.revision ?? (currentHealthRev || "1"));

    for (const entry of added) {
      if (entry.source) knownSourceNames.add(entry.source);
    }

    let applied = await applyCatalogSources({
      pluginId: plugin.id,
      revision,
      full,
      added,
      removed,
    });

    // If a delta was requested with a stored revision from a previous DB, but the local DB has 0 sources,
    // re-fetch full index once so the DB is populated.
    if (!full && lastRev && applied && applied.sources_total === 0) {
      const fullPayload = await fetchIndex("");
      if (fullPayload) {
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
    }

    setSavedPluginRevision(plugin.id, revision);
    syncedSessionRevisions.set(plugin.id, currentHealthRev || revision);
    if (full || added.length > 0 || removed.length > 0) {
      publish();
    }
  } catch (error) {
    void narrate(
      `Provider '${plugin.name}' · source-index sync failed: ${error instanceof Error ? error.name : "unknown error"}.`,
      { area: "DOWNLOAD_SOURCES", level: "WARN" },
    );
  }
}

export async function checkPluginSources(_games?: CatalogGame[]): Promise<Record<number, number>> {
  if (pendingSync) return pendingSync;
  const run = (async () => {
    const manifests = await plugins();
    await Promise.all(manifests.map(plugin => syncPluginIndex(plugin)));
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
