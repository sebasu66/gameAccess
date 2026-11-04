import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { hasTauriRuntime } from "./native";
import { uiDemo } from "./devDemo/uiDemo";

/**
 * The player's AI connection: a free Ollama Cloud key (ai_connection.rs). The key stays in Rust, protected by Windows;
 * the interface only learns whether there is one and its last four characters.
 */
export interface AiState { connected: boolean; ending: string }
/** Why a test failed: Ollama refused the key, the free use ran out, there was no answer, or another status. */
export type AiTestError = "no_key" | "rejected" | "limit" | "offline" | "failed";

export const AI_KEY_EVENT = "gameaccess:ai-key";
export const AI_GOOGLE_EVENT = "gameaccess:ai-google";
export const AI_GUIDE_CLOSED_EVENT = "gameaccess:ai-guide-closed";
/** Asks the screen that owns the wizard to open it (Settings › AI). */
export const OPEN_AI_CONNECT_EVENT = "gameaccess:open-ai-connect";

// Browser preview (`?uiDemo=1`): no Rust, so the state lives here and the guide window is played by a timer.
const demo = () => import.meta.env.DEV && uiDemo() && !hasTauriRuntime();
const DEMO_KEY = "gameaccess:demo-ai";
let demoState: AiState = (() => { try { return JSON.parse(sessionStorage.getItem(DEMO_KEY) || "null") ?? { connected: false, ending: "" }; } catch { return { connected: false, ending: "" }; } })();
const setDemo = (next: AiState) => { demoState = next; try { sessionStorage.setItem(DEMO_KEY, JSON.stringify(next)); } catch { /* the preview only */ } return next; };
const demoEmit = (name: string, detail: unknown, ms: number) => window.setTimeout(() => window.dispatchEvent(new CustomEvent(name, { detail })), ms);

export async function aiState(): Promise<AiState> {
  if (demo()) return demoState;
  if (!hasTauriRuntime()) return { connected: false, ending: "" };
  return invoke<AiState>("ai_state");
}

export async function aiSaveKey(key: string): Promise<AiState> {
  if (demo()) return setDemo({ connected: true, ending: key.trim().slice(-4) });
  return invoke<AiState>("ai_save_key", { key });
}

export async function aiDisconnect(): Promise<void> {
  if (demo()) { setDemo({ connected: false, ending: "" }); return; }
  await invoke("ai_disconnect");
}

/** Asks the free model one word with the kept key; resolves to the model's name. */
export async function aiTest(): Promise<string> {
  if (demo()) { await new Promise(resolve => window.setTimeout(resolve, 900)); return "gemma4:31b"; }
  return invoke<string>("ai_test");
}

export function aiTestError(error: unknown): AiTestError {
  const said = String(error instanceof Error ? error.message : error);
  return (["no_key", "rejected", "limit", "offline"] as const).find(kind => kind === said) ?? "failed";
}

/** Opens Ollama's key page in a Game Access window with the guide over it. */
export async function aiGuideOpen(): Promise<void> {
  if (demo()) { setDemo({ connected: true, ending: "a91f" }); demoEmit(AI_KEY_EVENT, { ending: "a91f" }, 2500); demoEmit(AI_GUIDE_CLOSED_EVENT, { saved: true }, 3700); return; }
  await invoke("ai_guide_open");
}

export async function aiOpenKeysInBrowser(): Promise<void> {
  if (demo()) { window.open("https://ollama.com/settings/keys", "_blank", "noopener"); return; }
  await invoke("ai_open_keys_in_browser");
}

/** Listens to the guide window: the key kept, Google chosen (it does not work there), the window closed. */
export function listenAiGuide(handlers: { key: (ending: string) => void; google: () => void; closed: (saved: boolean) => void }): () => void {
  const onKey = (detail: unknown) => handlers.key(String((detail as { ending?: string } | null)?.ending ?? ""));
  const onClosed = (detail: unknown) => handlers.closed(Boolean((detail as { saved?: boolean } | null)?.saved));
  if (!hasTauriRuntime()) {
    const key = (event: Event) => onKey((event as CustomEvent).detail);
    const closed = (event: Event) => onClosed((event as CustomEvent).detail);
    const google = () => handlers.google();
    window.addEventListener(AI_KEY_EVENT, key); window.addEventListener(AI_GUIDE_CLOSED_EVENT, closed); window.addEventListener(AI_GOOGLE_EVENT, google);
    return () => { window.removeEventListener(AI_KEY_EVENT, key); window.removeEventListener(AI_GUIDE_CLOSED_EVENT, closed); window.removeEventListener(AI_GOOGLE_EVENT, google); };
  }
  const stops = [listen(AI_KEY_EVENT, event => onKey(event.payload)), listen(AI_GOOGLE_EVENT, () => handlers.google()), listen(AI_GUIDE_CLOSED_EVENT, event => onClosed(event.payload))];
  return () => { for (const stop of stops) void stop.then(unlisten => unlisten()); };
}

/** A pasted key that could be one: one token without spaces. Ollama decides whether it works. */
export const looksLikeKey = (text: string) => /^[\x21-\x7e]{16,256}$/.test(text.trim());

/** Whether the player has an AI connected, asked once per screen that needs it (the search, Home). */
export function useAiConnected(): boolean {
  const [connected, setConnected] = useState(false);
  useEffect(() => {
    let alive = true;
    const check = () => void aiState().then(state => { if (alive) setConnected(state.connected); }).catch(() => undefined);
    check();
    window.addEventListener("focus", check);
    return () => { alive = false; window.removeEventListener("focus", check); };
  }, []);
  return connected;
}
