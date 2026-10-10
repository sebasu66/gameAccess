import { narrate } from "../narrationLog";
import { invoke } from "@tauri-apps/api/core";
import type { CatalogGame } from "../types";

export interface PluginManifest { id: string; name: string; endpoint: string; type: string; }
export interface PluginSource {
  title: string; url: string; type: string; size: string; score: number;
  pluginName: string; sourceName: string;
}
export interface SourceAvailability { count: number; names: string[]; }
export const SOURCES_CHANGED_EVENT = "gameaccess:sources-changed";
const availability = new Map<number, SourceAvailability>();
const detailSources = new Map<number, PluginSource[]>();
const pending = new Map<string, Promise<Record<number, number>>>();
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
    return result.filter(plugin => plugin.type === "source_provider" && /^https?:\/\//.test(plugin.endpoint));
  } catch { return []; }
}
function endpoint(plugin: PluginManifest, path: string): string {
  return plugin.endpoint.replace(/\/+$/, "") + path;
}
function publish(): void {
  if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") window.dispatchEvent(new Event(SOURCES_CHANGED_EVENT));
}
function validUrl(value: unknown): value is string {
  return typeof value === "string" && /^(magnet:\?|https?:\/\/)/i.test(value.trim());
}
function normalizeSource(value: unknown, plugin: PluginManifest): PluginSource[] {
  if (!value || typeof value !== "object") return [];
  const item = value as Record<string, unknown>;
  if (!validUrl(item.url)) return [];
  return [{
    title: typeof item.title === "string" ? item.title : plugin.name,
    url: item.url.trim(), type: typeof item.type === "string" ? item.type : "http",
    size: typeof item.size === "string" ? item.size : "",
    score: typeof item.score === "number" && Number.isFinite(item.score) ? item.score : 0,
    pluginName: plugin.name, sourceName: typeof item.sourceName === "string" ? item.sourceName : plugin.name,
  }];
}
export async function getPluginSources(game: CatalogGame): Promise<PluginSource[]> {
  const manifests = await plugins();
  void narrate(`AppID ${keyOf(game)} · source discovery started for '${game.name}' with ${manifests.length} registered provider(s).`, { area: "DOWNLOAD_SOURCES" });
  const results = await Promise.all(manifests.map(async plugin => {
    try {
      const params = new URLSearchParams({ app_id: String(keyOf(game)), name: game.name });
      const response = await fetch(endpoint(plugin, "/api/sources?" + params), { signal: AbortSignal.timeout(8000) });
      if (!response.ok) {
        void narrate(`AppID ${keyOf(game)} · provider '${plugin.name}' replied HTTP ${response.status}.`, { area: "DOWNLOAD_SOURCES", level: "WARN" });
        return [];
      }
      const data: unknown = await response.json();
      const received = Array.isArray(data) ? data.flatMap(value => normalizeSource(value, plugin)) : [];
      void narrate(`AppID ${keyOf(game)} · provider '${plugin.name}' returned ${received.length} usable option(s).`, { area: "DOWNLOAD_SOURCES" });
      return received;
    } catch (error) {
      void narrate(`AppID ${keyOf(game)} · provider '${plugin.name}' source request failed: ${error instanceof Error ? error.name : "unknown error"}.`, { area: "DOWNLOAD_SOURCES", level: "WARN" });
      return [];
    }
  }));
  const seen = new Set<string>();
  const sources = results.flat().sort((a,b) => b.score - a.score).filter(source => {
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
export async function checkPluginSources(games: CatalogGame[]): Promise<Record<number, number>> {
  const key = JSON.stringify(games.map(game => [keyOf(game), game.name]));
  const existing = pending.get(key);
  if (existing) return existing;
  const request = check(games).finally(() => pending.delete(key));
  pending.set(key, request);
  return request;
}
async function check(games: CatalogGame[]): Promise<Record<number, number>> {
  const next = new Map<number, SourceAvailability>(games.map(game => [keyOf(game), { count: 0, names: [] }]));
  const manifests = await plugins();
  void narrate(`Source availability scan started: ${games.length} game(s), ${manifests.length} provider(s), batches of 100.`, { area: "DOWNLOAD_SOURCES" });
  await Promise.all(manifests.map(async plugin => {
    for (let start = 0; start < games.length; start += 100) {
      const batch = games.slice(start, start + 100);
      try {
        const response = await fetch(endpoint(plugin, "/api/bulk_check"), {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ include_sources: true, games: batch.map(game => ({ id: keyOf(game), name: game.name })) }),
          signal: AbortSignal.timeout(15000),
        });
        if (!response.ok) continue;
        const data = await response.json() as Record<string, unknown>;
        for (const game of batch) {
          const raw = data[String(keyOf(game))];
          const value = typeof raw === "number" ? raw : raw && typeof raw === "object" ? (raw as { count?: unknown }).count : 0;
          const count = typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
          if (!count) continue;
          const entry = next.get(keyOf(game))!;
          const labels = raw && typeof raw === "object" ? (raw as { sources?: unknown }).sources : null;
          const names = Array.isArray(labels) ? labels.filter((name): name is string => typeof name === "string") : [];
          entry.count += count; entry.names.push(...(names.length ? names : [plugin.name]));
        }
      } catch { /* An unavailable provider must not block other plugins or browsing. */ }
    }
  }));
  for (const [id, entry] of next) availability.set(id, entry);
  void narrate(`Source availability scan finished: ${[...next.values()].filter(entry => entry.count > 0).length} game(s) with sources.`, { area: "DOWNLOAD_SOURCES" });
  publish();
  return Object.fromEntries([...next].map(([id, entry]) => [id, entry.count]));
}
