import { useEffect, type ReactNode } from "react";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { hasTauriRuntime } from "./native";
import { narrate } from "./narrationLog";
import { updatesEnabled } from "./appUpdate";
import { runAppUpdateTask } from "./centralDialog/updateTask";

const deps = {
  check: () => check(),
  relaunch: () => relaunch(),
  log: (message: string, level: "INFO" | "WARN" = "INFO") => void narrate(message, { area: "UPDATE", level }),
};

/**
 * Mandatory self-update for releases from main. The app keeps starting while the check runs (it takes a second);
 * when a newer version exists the central dialog covers everything until it is installed and the app restarts.
 */
export default function UpdateGate({ children }: { children: ReactNode }) {
  useEffect(() => {
    if (updatesEnabled(import.meta.env.VITE_GAMEACCESS_CHANNEL, hasTauriRuntime())) void runAppUpdateTask(deps);
  }, []);
  return <>{children}</>;
}
