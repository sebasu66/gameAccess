import { invoke } from "@tauri-apps/api/core";
import type { PluginManifest } from "./PluginSources";

/** What a source plugin offers to the app's settings (its tab in Settings), beside the downloads it serves: the
 *  lists of downloads it reads (feeds, by address or loaded from a file), a search among them by name and a link's
 *  file. A plugin says so with the `manage` capability in /api/health; without it the tab only shows it and can
 *  uninstall it. The app knows nothing else about any particular plugin. */
export interface PluginFeeds { feeds: string[]; syncing: boolean; sourceCount: number }
export interface PluginSearchResult { title: string; url: string; size?: string | number; score?: number; source?: string }
export interface PluginHealth { capabilities: string[]; sourceCount?: number; syncing?: boolean }

const base = (plugin: PluginManifest) => plugin.endpoint.replace(/\/+$/, "");

async function call<T>(plugin: PluginManifest, path: string, init?: RequestInit, timeout = 15000): Promise<T> {
  const response = await fetch(base(plugin) + path, { ...init, cache: "no-store", signal: AbortSignal.timeout(timeout),
    headers: init?.body ? { "Content-Type": "application/json" } : undefined });
  const body = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
  return body;
}

export async function pluginHealth(plugin: PluginManifest): Promise<PluginHealth> {
  const health = await call<{ capabilities?: unknown; sourceCount?: number; syncing?: boolean }>(plugin, "/api/health", undefined, 5000);
  return { capabilities: Array.isArray(health.capabilities) ? health.capabilities.map(String) : [], sourceCount: health.sourceCount, syncing: health.syncing };
}
export const canManage = (health: PluginHealth | null) => Boolean(health?.capabilities.includes("manage"));

export const pluginFeeds = (plugin: PluginManifest) => call<PluginFeeds>(plugin, "/api/manage/feeds");
/** A feed by its address (http/https), checked by the plugin before it keeps it. */
export const addPluginFeed = (plugin: PluginManifest, url: string) =>
  call<PluginFeeds>(plugin, "/api/manage/feeds", { method: "POST", body: JSON.stringify({ url }) }, 60000);
/** A list of downloads chosen as a file on this PC: its content goes to the plugin, which keeps it as a feed. */
export const addPluginFeedFile = (plugin: PluginManifest, name: string, content: string) =>
  call<PluginFeeds>(plugin, "/api/manage/feeds/file", { method: "POST", body: JSON.stringify({ name, content }) }, 60000);
export const removePluginFeed = (plugin: PluginManifest, url: string) =>
  call<PluginFeeds>(plugin, "/api/manage/feeds", { method: "DELETE", body: JSON.stringify({ url }) });
export const searchPlugin = (plugin: PluginManifest, query: string) =>
  call<{ results: PluginSearchResult[] }>(plugin, "/api/manage/search?q=" + encodeURIComponent(query)).then(result => result.results ?? []);
/** The file behind a result's link (a hosting page becomes its direct link when the plugin knows how). */
export const pluginLink = (plugin: PluginManifest, url: string) =>
  call<{ url: string; mode?: string }>(plugin, "/api/manage/link?url=" + encodeURIComponent(url), undefined, 60000);
/** Stops the plugin and deletes its folder (only one installed in the app's data folder). */
export const uninstallPlugin = (id: string) => invoke<void>("uninstall_plugin", { id });
