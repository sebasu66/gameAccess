import { invoke } from "@tauri-apps/api/core";
import { narrate } from "../narrationLog";
import type { PluginManifest } from "./PluginSources";
export const PLUGINS_CHANGED_EVENT = "gameaccess:plugins-changed";
export interface PluginStatus extends PluginManifest {
  alive: boolean; revision: string; instanceId: string; dirty: boolean;
}
let statuses: PluginStatus[] = [];
let generation = 0;
let signature = "";
let polling: Promise<void> | null = null;
let watchers = 0;
let driver = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();
export const getPluginStatuses = () => statuses;
export const pluginGeneration = () => generation;
export function subscribePluginStatuses(listener: () => void) {
  listeners.add(listener); return () => { listeners.delete(listener); };
}
const HEALTH_TIMEOUT_MS = 5000;
const MAX_CONSECUTIVE_FAILURES = 3;
const failureCounts = new Map<string, number>();
const lastAliveStatuses = new Map<string, PluginStatus>();

export function resetPluginRuntime(): void {
  statuses = [];
  signature = "";
  failureCounts.clear();
  lastAliveStatuses.clear();
}

export function providerAvailable(plugin: PluginManifest): boolean {
  return statuses.find(item => item.id === plugin.id && item.endpoint === plugin.endpoint)?.alive !== false;
}
async function inspect(plugin: PluginManifest): Promise<PluginStatus> {
  const key = `${plugin.id}|${plugin.endpoint}`;
  const offline: PluginStatus = { ...plugin, alive: false, revision: "", instanceId: "", dirty: false };
  const recordFailure = (): PluginStatus => {
    const failures = (failureCounts.get(key) ?? 0) + 1;
    failureCounts.set(key, failures);
    const previous = lastAliveStatuses.get(key);
    if (previous && failures < MAX_CONSECUTIVE_FAILURES) {
      return previous;
    }
    lastAliveStatuses.delete(key);
    return offline;
  };
  try {
    const base = plugin.endpoint.replace(/\/+$/, "");
    const response = await fetch(base + "/api/health", { signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS), cache: "no-store" });
    if (response.status === 404) {
      const legacy = await fetch(base + "/api/sources", { signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS), cache: "no-store" });
      if (!legacy.ok) return recordFailure();
      failureCounts.set(key, 0);
      const legacyStatus: PluginStatus = { ...offline, alive: true, revision: String(Math.floor(Date.now() / 30000)) };
      lastAliveStatuses.set(key, legacyStatus);
      return legacyStatus;
    }
    if (!response.ok) return recordFailure();
    const health = await response.json() as Record<string, unknown>;
    if (typeof health.id === "string" && health.id !== plugin.id) {
      failureCounts.set(key, MAX_CONSECUTIVE_FAILURES);
      lastAliveStatuses.delete(key);
      return offline;
    }
    failureCounts.set(key, 0);
    const online: PluginStatus = {
      ...plugin,
      alive: true,
      revision: String(health.revision ?? Math.floor(Date.now() / 30000)),
      instanceId: String(health.instanceId ?? ""),
      dirty: health.dirty === true,
    };
    lastAliveStatuses.set(key, online);
    return online;
  } catch {
    return recordFailure();
  }
}
export function pollPluginRuntime(): Promise<void> {
  if (polling) return polling;
  polling = (async () => {
    try {
      const manifests = await invoke<PluginManifest[]>("get_registered_plugins");
      const providers = manifests.filter(item => item.type === "source_provider" && /^https?:\/\//.test(item.endpoint));
      const activeKeys = new Set(providers.map(item => `${item.id}|${item.endpoint}`));
      for (const k of failureCounts.keys()) {
        if (!activeKeys.has(k)) failureCounts.delete(k);
      }
      for (const k of lastAliveStatuses.keys()) {
        if (!activeKeys.has(k)) lastAliveStatuses.delete(k);
      }
      const next = await Promise.all(providers.map(inspect));
      next.sort((a, b) => a.id.localeCompare(b.id) || a.endpoint.localeCompare(b.endpoint));
      const key = JSON.stringify(next);
      if (key === signature) return;
      signature = key; statuses = next; generation++;
      void narrate("Plugin state changed: " + (next.length ? next.map(item => item.name + "=" + (item.alive ? "online r" + item.revision + (item.dirty ? " (outdated)" : "") : "offline")).join(", ") : "no source plugins"), { area: "DOWNLOAD_SOURCES" });
      for (const listener of listeners) listener();
      if (typeof window !== "undefined") window.dispatchEvent(new Event(PLUGINS_CHANGED_EVENT));
    } catch (error) {
      void narrate("Plugin registry monitoring failed.", { area: "DOWNLOAD_SOURCES", level: "WARN" });
    }
  })().finally(() => { polling = null; });
  return polling;
}
async function tick(run: number) {
  await pollPluginRuntime();
  if (watchers > 0 && run === driver) timer = setTimeout(() => void tick(run), 3000);
}
export function monitorPluginRuntime(): () => void {
  watchers++;
  if (watchers === 1) {
    if (timer) clearTimeout(timer);
    void tick(++driver);
  }
  return () => {
    watchers = Math.max(0, watchers - 1);
    if (!watchers) { driver++; if (timer) clearTimeout(timer); timer = undefined; }
  };
}
if (typeof window !== "undefined") {
  window.addEventListener("focus", () => void pollPluginRuntime());
}
