import { invoke } from "@tauri-apps/api/core";
import type { PluginManifest } from "./PluginSources";

/**
 * The form a plugin shares with Settings › Plugins (docs/PLUGIN_DOWNLOADS.md, "Plugin form"). A plugin answers
 * GET /api/ui?lang=es|en with what it is and what the player can do with it, as data: the app draws every plugin with
 * the same controls and knows nothing about any of them. No plugin code or markup runs in the app, and a plugin only
 * names paths on its own address. Without /api/ui the plugin shows with its name, its state and uninstall.
 *
 * - "list": things the plugin keeps. GET path → PluginListData; POST path {value} adds; DELETE path {value} removes;
 *   POST addFile.path {name, content} adds a file chosen on this PC. Each of them answers the new PluginListData.
 * - "search": GET path?q= → {results}. A result offers download and copy link; linkPath?url= turns its link into the
 *   file behind it ({url}) when the plugin knows how.
 */
export interface PluginListSection {
  type: "list"; id: string; title: string; hint?: string; path: string; removeLabel?: string;
  add?: { placeholder: string; label: string; /** A regular expression the value has to match. */ pattern?: string };
  addFile?: { path: string; label: string; accept?: string };
}
export interface PluginSearchSection {
  type: "search"; id: string; title: string; path: string; placeholder: string; button: string; empty?: string; hint?: string; linkPath?: string;
}
export type PluginSection = PluginListSection | PluginSearchSection;
export interface PluginUi { schema: 1; description?: string; homepage?: string; sections: PluginSection[] }
export interface PluginListData { items: string[]; busy?: boolean; busyText?: string; summary?: string }
export interface PluginResult { title: string; link: string; meta?: string }

const base = (plugin: PluginManifest) => plugin.endpoint.replace(/\/+$/, "");
/** Only a path on the plugin's own address: what a plugin declares can never send the app elsewhere. */
export const ownPath = (path: unknown): path is string => typeof path === "string" && /^\/[^/\\]/.test(path);

async function call<T>(plugin: PluginManifest, path: string, init?: RequestInit, timeout = 15000): Promise<T> {
  if (!ownPath(path)) throw new Error("Invalid plugin path");
  const response = await fetch(base(plugin) + path, { ...init, cache: "no-store", signal: AbortSignal.timeout(timeout),
    headers: init?.body ? { "Content-Type": "application/json" } : undefined });
  const body = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
  return body;
}

const known = (section: PluginSection) => ownPath(section?.path) && typeof section.id === "string" && typeof section.title === "string"
  && (section.type === "list" ? section.addFile === undefined || ownPath(section.addFile.path)
    : section.type === "search" && (section.linkPath === undefined || ownPath(section.linkPath)));

/** The plugin's form, or null when it shares none. A section the app cannot draw is left out. */
export async function pluginUi(plugin: PluginManifest, lang: string): Promise<PluginUi | null> {
  try {
    const ui = await call<PluginUi>(plugin, `/api/ui?lang=${encodeURIComponent(lang)}`, undefined, 5000);
    if (ui?.schema !== 1 || !Array.isArray(ui.sections)) return null;
    return { ...ui, sections: ui.sections.filter(known) };
  } catch { return null; }
}

export const pluginList = (plugin: PluginManifest, section: PluginListSection) => call<PluginListData>(plugin, section.path);
export const pluginListAdd = (plugin: PluginManifest, section: PluginListSection, value: string) =>
  call<PluginListData>(plugin, section.path, { method: "POST", body: JSON.stringify({ value }) }, 60000);
export const pluginListAddFile = (plugin: PluginManifest, section: PluginListSection, name: string, content: string) =>
  call<PluginListData>(plugin, section.addFile!.path, { method: "POST", body: JSON.stringify({ name, content }) }, 60000);
export const pluginListRemove = (plugin: PluginManifest, section: PluginListSection, value: string) =>
  call<PluginListData>(plugin, section.path, { method: "DELETE", body: JSON.stringify({ value }) });
export const pluginSearch = (plugin: PluginManifest, section: PluginSearchSection, query: string) =>
  call<{ results?: PluginResult[] }>(plugin, `${section.path}?q=${encodeURIComponent(query)}`).then(result => result.results ?? []);
/** The file behind a result's link; the link itself when the plugin cannot say. */
export const pluginLink = (plugin: PluginManifest, section: PluginSearchSection, link: string) => section.linkPath
  ? call<{ url?: string }>(plugin, `${section.linkPath}?url=${encodeURIComponent(link)}`, undefined, 60000).then(result => result.url || link).catch(() => link)
  : Promise.resolve(link);

/** Stops the plugin and deletes its folder (only one installed in the app's data folder). */
export const uninstallPlugin = (id: string) => invoke<void>("uninstall_plugin", { id });
/** The player's on/off: closes it or starts it, and keeps the choice. */
export const setPluginEnabled = (id: string, on: boolean) => invoke<void>("set_plugin_enabled", { id, on });
