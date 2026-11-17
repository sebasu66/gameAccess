/**
 * Development-only auto-login.
 *
 * During development the gate is handed a key from the local `.env` so it does
 * not have to be typed on every launch. The key is read by the Rust side at run
 * time (`read_dev_activation_key`), never compiled into the bundle: Vite's
 * `VITE_*` variables are inlined into the executable, which would ship a working
 * access key inside the artifact.
 *
 * Every path here is best-effort. A normal installation has no `.env`, and the
 * gate must open exactly as before when that is the case.
 */
import { hasTauriRuntime } from "./native";
import { narrate } from "./narrationLog";

/** Name of the variable read from the repository `.env`. */
export const DEV_KEY_NAME = "devKEY";

/**
 * The development key, or null when there is none.
 *
 * Returns null outside the desktop runtime, when no `.env` exists, and when the
 * file has no entry — all of which are normal, so none of them is reported as a
 * failure to the user.
 */
export async function readDevActivationKey(): Promise<string | null> {
  if (!hasTauriRuntime()) return null;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const key = await invoke<string | null>("read_dev_activation_key");
    return key?.trim() ? key.trim() : null;
  } catch (error) {
    // A missing or unreadable `.env` is not an error worth interrupting a launch
    // for; it only means the convenience is unavailable.
    void narrate(`Development key unavailable: ${String(error)}`, { area: "ACTIVATION", level: "WARN" });
    return null;
  }
}

/**
 * The key to try on this launch, if any.
 *
 * Skipped once a session is already active, so the auto-login never replaces a
 * valid session or re-sends a key the server has already accepted.
 */
export async function devAutoLoginKey(sessionActive: boolean): Promise<string | null> {
  if (sessionActive) return null;
  const key = await readDevActivationKey();
  if (key) void narrate("Development key found in .env; signing in automatically.", { area: "ACTIVATION" });
  return key;
}
