import { useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";
import { hasTauriRuntime } from "./native";

/**
 * Shortcuts to programs that are not library games (src-tauri/src/app_shortcuts.rs): Roblox, a drawing program...
 * Never matched to Steam nor moved into the games folder; the library manager shows them in their own section.
 */
export interface AppShortcut { id: number; name: string; target: string; arguments: string[]; folder: string; source: string }

let items: AppShortcut[] = [];
let loaded = false;
const listeners = new Set<() => void>();
const emit = () => { for (const listener of listeners) listener(); };
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const snapshot = () => items;

/** Sample shortcuts for design work in the browser (dev builds only). */
const demo = (): AppShortcut[] => import.meta.env.DEV ? [
  { id: 1793200000, name: "Roblox Player", target: "%LOCALAPPDATA%\\Roblox\\Versions\\version-1\\RobloxPlayerBeta.exe", arguments: [], folder: "%LOCALAPPDATA%\\Roblox", source: "" },
  { id: 1793200100, name: "Krita", target: "%ProgramFiles%\\Krita (x64)\\bin\\krita.exe", arguments: [], folder: "%ProgramFiles%\\Krita (x64)", source: "" },
] : [];

export async function loadShortcuts(force = false): Promise<void> {
  if (loaded && !force) return;
  loaded = true;
  items = hasTauriRuntime() ? await invoke<AppShortcut[]>("shortcuts_list").catch(() => []) : demo();
  emit();
}

export function useShortcuts(): AppShortcut[] {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/** Asks for a program or shortcut file (.exe, .lnk, .url) and adds it. Null when nothing was picked. */
export async function addShortcut(filterName: string): Promise<AppShortcut | null> {
  if (!hasTauriRuntime()) return null;
  const { open } = await import("@tauri-apps/plugin-dialog");
  const picked = await open({ multiple: false, directory: false, filters: [{ name: filterName, extensions: ["exe", "lnk", "url"] }] });
  if (typeof picked !== "string") return null;
  const added = await invoke<AppShortcut>("shortcut_add", { path: picked });
  items = [...items, added];
  emit();
  return added;
}

export async function removeShortcut(id: number): Promise<void> {
  if (hasTauriRuntime()) await invoke("shortcut_remove", { id });
  items = items.filter(item => item.id !== id);
  emit();
}

export async function openShortcut(id: number): Promise<void> {
  if (hasTauriRuntime()) await invoke("shortcut_open", { id });
}
