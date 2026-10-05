import { invoke } from "@tauri-apps/api/core";
import { narrate } from "../narrationLog";
import type { CatalogGame } from "../types";
import type { DigitalGameRecord } from "./DigitalCatalog";

export interface ProcessExecutionResult {
  ok: boolean;
  action: "play" | "uninstall";
  app_id: number;
  name?: string;
  pid?: number;
  exit_code?: number;
  stdout?: string;
  stderr?: string;
  error?: string;
  command: string;
}

const hasTauriRuntime = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/**
 * Dedicated Process Manager for the Digital tab.
 *
 * Executes the terminal command sequences specified in `playProcess` and `uninstallProcess`
 * by passing them to the Python process runner (`digital_process_runner.py`) via Tauri.
 */
export class DigitalProcessManager {
  executePlay(game: CatalogGame, record?: DigitalGameRecord, workingDir?: string): Promise<ProcessExecutionResult> {
    return this.execute("play", game, record, workingDir);
  }

  executeUninstall(game: CatalogGame, record?: DigitalGameRecord, workingDir?: string): Promise<ProcessExecutionResult> {
    return this.execute("uninstall", game, record, workingDir);
  }

  private async execute(action: "play" | "uninstall", game: CatalogGame, record?: DigitalGameRecord, workingDir?: string): Promise<ProcessExecutionResult> {
    const appId = record?.id ?? game.app_id ?? game.id;
    const name = record?.name ?? game.name;
    const field = action === "play" ? "playProcess" : "uninstallProcess";
    const command = record?.[field] || "";
    try {
      if (!command.trim()) {
        throw new Error(`El juego '${name}' no tiene configurado un '${field}' para ${action === "play" ? "ejecutarse" : "desinstalar"}.`);
      }
      if (hasTauriRuntime()) {
        const result = await invoke<ProcessExecutionResult>("run_digital_process", {
          action, appId, name, command, workingDir: workingDir ?? null,
        });
        if (!result.ok) throw new Error(result.error || result.stderr || `El proceso terminó con código ${result.exit_code ?? "desconocido"}`);
        return result;
      }
      return { ok: true, action, app_id: appId, name, command, ...(action === "play" ? { pid: 12345 } : { exit_code: 0 }) };
    } catch (error) {
      void narrate(`Digital AppID ${appId} · ${action}: ${error instanceof Error ? error.message : String(error)}`, { area: "DIGITAL_EXECUTION", level: "ERROR" });
      throw error;
    }
  }
}

export const digitalProcessManager = new DigitalProcessManager();
