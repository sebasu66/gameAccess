import { useSyncExternalStore } from "react";
import { hideNotice, showNotice, type NoticeTone } from "./notice/notice";
import { translate } from "./i18n";

/**
 * App-wide notifications: anything can call notify(). The message is shown in the single notice
 * (src/notice); this list keeps the recent ones for code and tests that read them.
 */
export type ToastTone = "info" | "success" | "warning" | "error";
export interface Toast {
  id: number;
  message: string;
  tone: ToastTone;
  durationMs: number;
}

const MAX_VISIBLE = 4;
const NOTICE_TONE: Record<ToastTone, NoticeTone> = { info: "info", success: "ok", warning: "info", error: "error" };
const DEFAULT_DURATION_MS = 6000;
const listeners = new Set<() => void>();
const timers = new Map<number, ReturnType<typeof setTimeout>>();
let toasts: Toast[] = [];
let nextId = 1;

function emit(): void {
  listeners.forEach(listener => listener());
}

function playToastBeep(): void {
  try {
    const AudioContextCtor = window.AudioContext
      ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextCtor) return;
    const context = new AudioContextCtor();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const now = context.currentTime;
    oscillator.type = "square";
    oscillator.frequency.setValueAtTime(880, now);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.08, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(now);
    oscillator.stop(now + 0.13);
    oscillator.onended = () => { void context.close(); };
  } catch {
    // The visual notification is authoritative; audio is optional.
  }
}

export function dismissToast(id: number): void {
  clearTimeout(timers.get(id));
  timers.delete(id);
  const next = toasts.filter(toast => toast.id !== id);
  if (next.length === toasts.length) return;
  toasts = next;
  emit();
}

export function notify(message: string, options: { tone?: ToastTone; durationMs?: number; silent?: boolean } = {}): number {
  const text = message.trim();
  if (!text) return 0;
  // The same message twice in a row (a retry, a double event) refreshes the visible one instead of stacking.
  const existing = toasts.find(toast => toast.message === text);
  if (existing) dismissToast(existing.id);
  const toast: Toast = { id: nextId++, message: text, tone: options.tone ?? "info", durationMs: options.durationMs ?? DEFAULT_DURATION_MS };
  toasts = [...toasts, toast].slice(-MAX_VISIBLE);
  if (toast.durationMs > 0 && typeof setTimeout !== "undefined") timers.set(toast.id, setTimeout(() => dismissToast(toast.id), toast.durationMs));
  if (!options.silent && typeof window !== "undefined") playToastBeep();
  // Errors and messages meant to stay (duration 0) wait for the player; the rest close with the timer.
  const sticky = toast.tone === "error" || toast.durationMs <= 0;
  showNotice({ title: text, tone: NOTICE_TONE[toast.tone], actions: sticky ? [{ label: translate("close"), run: () => hideNotice() }] : undefined });
  emit();
  return toast.id;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function getToasts(): Toast[] {
  return toasts;
}

export function useToasts(): Toast[] {
  return useSyncExternalStore(subscribe, getToasts, getToasts);
}
