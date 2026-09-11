import { useSyncExternalStore } from "react";
import type { SetStateAction } from "react";
interface AudioSettings { volume: number; muted: boolean }
const defaults: AudioSettings = { volume: 0.68, muted: true };
let settings: AudioSettings | undefined;
const listeners = new Set<() => void>();
export function readMediaAudio(): AudioSettings {
  if (settings) return settings;
  try {
    const saved = JSON.parse(localStorage.getItem("gameaccess:media-audio") || "null");
    settings = saved && typeof saved.volume === "number" && Number.isFinite(saved.volume) && typeof saved.muted === "boolean" ? { volume: Math.max(0, Math.min(1, saved.volume)), muted: saved.muted } : defaults;
  } catch { settings = defaults; }
  return settings;
}
function update(value: AudioSettings) {
  settings = value;
  try { localStorage.setItem("gameaccess:media-audio", JSON.stringify(settings)); } catch { /* Keep shared settings for this session. */ }
  for (const listener of listeners) listener();
}
export function setMediaVolume(value: SetStateAction<number>) { const current=readMediaAudio(); const volume=typeof value === "function" ? value(current.volume) : value; update({ ...current, volume: Math.max(0, Math.min(1, volume)) }); }
export function setMediaMuted(value: SetStateAction<boolean>) { const current=readMediaAudio(); update({ ...current, muted: typeof value === "function" ? value(current.muted) : value }); }
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export function useSharedMediaAudio() {
  const audio = useSyncExternalStore(subscribe, readMediaAudio, () => defaults);
  return { ...audio, setVolume: setMediaVolume, setMuted: setMediaMuted };
}
