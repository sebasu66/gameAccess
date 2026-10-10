import { invoke } from "@tauri-apps/api/core";
import { narrate } from "../narrationLog";
import { supplyArchivePasswords } from "./archivePasswords";
import type { CatalogGame } from "../types";
import type { DigitalGameRecord } from "./DigitalCatalog";

export interface ProcessExecutionResult {
  ok: boolean;
  action: "play" | "uninstall" | "status" | "snapshot" | "open-folder";
  app_id: number;
  name?: string;
  pid?: number;
  exit_code?: number;
  stdout?: string;
  stderr?: string;
  error?: string;
  command: string;
  folder?: string;
  installed?: boolean;
  backup_requires_password?: boolean;
  statuses?: Record<string, { folder: string; installed: boolean }>;
}

const hasTauriRuntime = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/**
 * Dedicated Process Manager for the Digital tab.
 *
 * Runs the dedicated Digital folder lifecycle and resolves a local game executable
 * by passing them to the Python process runner (`digital_process_runner.py`) via Tauri.
 */
export class DigitalProcessManager {
  executePlay(game: CatalogGame, record?: DigitalGameRecord, workingDir?: string): Promise<ProcessExecutionResult> {
    return this.execute("play", game, record, workingDir);
  }

  executeUninstall(game: CatalogGame, record?: DigitalGameRecord, workingDir?: string): Promise<ProcessExecutionResult> {
    return this.execute("uninstall", game, record, workingDir);
  }

  status(game: CatalogGame): Promise<ProcessExecutionResult> { return this.execute("status", game); }

  openFolder(game: CatalogGame): Promise<ProcessExecutionResult> { return this.execute("open-folder", game); }

  snapshot(games: CatalogGame[]): Promise<ProcessExecutionResult> {
    return this.execute("snapshot", { id: 0, app_id: 0, name: "" } as CatalogGame, undefined, undefined, JSON.stringify(games.map(g => ({ id: g.app_id ?? g.id, name: g.name }))));
  }

  private async execute(action: ProcessExecutionResult["action"], game: CatalogGame, record?: DigitalGameRecord, workingDir?: string, payload?: string): Promise<ProcessExecutionResult> {
    const appId = record?.id ?? game.app_id ?? game.id;
    const name = record?.name ?? game.name;
    const autoInstalled = record?.auto_installed ?? (game as any).auto_installed ?? false;
    const command = payload ?? (action === "play" ? record?.playProcess || "" : "");
    if (action === "play" || action === "uninstall") void narrate(`Digital AppID ${appId} · ${action} requested for '${name}'; auto-installed=${autoInstalled}; executable selection=${command ? "configured" : "discovery"}.`, { area: "DIGITAL_EXECUTION" });
    try {
      if (hasTauriRuntime()) {
        if (action === "play") {
          void narrate(`Digital AppID ${appId} · checking game folder and backup requirements before launch.`, { area: "DIGITAL_EXECUTION" });
          const backup = await invoke<ProcessExecutionResult>("run_digital_process", { action: "status", appId, name, command: "", workingDir: null, autoInstalled });
          if (!backup.ok) throw new Error(backup.error || "No se pudo verificar el respaldo Digital.");
          if (!autoInstalled && backup.backup_requires_password) await supplyArchivePasswords(appId);
        }
        const result = await invoke<ProcessExecutionResult>("run_digital_process", {
          action, appId, name, command, workingDir: null, autoInstalled,
        });
        if (!result.ok) throw new Error(result.error || result.stderr || `El proceso terminó con código ${result.exit_code ?? "desconocido"}`);
        if (action === "play" || action === "uninstall") void narrate(`Digital AppID ${appId} · ${action} completed; ok=${result.ok}, pid=${result.pid ?? "none"}, exit=${result.exit_code ?? "running"}; folder=${result.folder ?? "unknown"}.`, { area: "DIGITAL_EXECUTION" });
        return result;
      }
      return { ok: true, action, app_id: appId, name, command, installed: false, statuses: {}, ...(action === "play" ? { pid: 12345 } : { exit_code: 0 }) };
    } catch (error) {
      void narrate(`Digital AppID ${appId} · ${action}: ${error instanceof Error ? error.message : String(error)}`, { area: "DIGITAL_EXECUTION", level: "ERROR" });
      throw error;
    }
  }
}

export const digitalProcessManager = new DigitalProcessManager();
