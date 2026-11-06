import { invoke } from "@tauri-apps/api/core";
import { hasTauriRuntime } from "./native";

/** Tells the native side the interface started. Without it, a release build looks for an update on its own. */
export function reportFrontendAlive(): void {
  if (hasTauriRuntime()) void invoke("app_frontend_alive").catch(() => undefined);
}
