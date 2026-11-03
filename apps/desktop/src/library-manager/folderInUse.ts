import { invoke } from "@tauri-apps/api/core";
import { translate } from "../i18n";
import { hasTauriRuntime } from "../native";
import { showNotice, type NoticeAction } from "../notice/notice";

/** A program holding a folder open (process_control.rs). */
export interface FolderLocker { pid: number; name: string; kind: "explorer" | "console" | "other" }

/** What the notice says about each program: Explorer windows, a console standing there, or any other program. */
export function lockerLines(lockers: FolderLocker[]): string[] {
  const lines: string[] = [];
  if (lockers.some(locker => locker.kind === "explorer")) lines.push(translate("inUseExplorer"));
  for (const locker of lockers) {
    if (locker.kind === "console") lines.push(translate("inUseConsole", { name: locker.name, pid: locker.pid }));
    else if (locker.kind === "other") lines.push(translate("inUseOther", { name: locker.name || `PID ${locker.pid}`, pid: locker.pid }));
  }
  return lines;
}

/**
 * A library action could not rename or move a folder because programs hold it open. The notice names them (Windows
 * is asked who they are) and offers to close the Explorer windows on that folder, then tries again; or simply to try
 * again once the player closed them. No program is killed.
 */
export async function showFolderInUse(folder: string, retry: () => void): Promise<void> {
  const lockers = hasTauriRuntime() ? await invoke<FolderLocker[]>("folder_lockers", { folder }).catch(() => []) : [];
  const lines = lockerLines(lockers);
  const actions: NoticeAction[] = [];
  if (lockers.some(locker => locker.kind === "explorer")) {
    actions.push({ label: translate("inUseCloseExplorer"), kind: "primary", run: () => {
      void invoke("close_explorer_windows", { folder }).catch(() => 0).then(() => window.setTimeout(retry, 400));
    } });
  }
  actions.push({ label: translate("inUseRetry"), kind: actions.length ? "secondary" : "primary", run: retry });
  showNotice({
    tone: "error",
    title: translate("inUseTitle"),
    text: [translate("inUseFolder", { folder }), ...(lines.length ? [translate("inUseWho"), ...lines.map(line => `• ${line}`)] : [translate("inUseUnknown")])].join("\n"),
    actions,
  });
}
