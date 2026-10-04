import { invoke } from "@tauri-apps/api/core";
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
  /**
   * Executes the terminal command sequence for `playProcess`.
   */
  async executePlay(
    game: CatalogGame,
    record?: DigitalGameRecord,
    workingDir?: string,
  ): Promise<ProcessExecutionResult> {
    const appId = record?.id ?? game.app_id ?? game.id;
    const name = record?.name ?? game.name;
    const command = record?.playProcess || "";

    if (!command.trim()) {
      throw new Error(`El juego '${name}' no tiene configurado un 'playProcess' para ejecutarse.`);
    }

    if (hasTauriRuntime()) {
      return invoke<ProcessExecutionResult>("run_digital_process", {
        action: "play",
        appId,
        name,
        command,
        workingDir: workingDir ?? null,
      });
    }

    // In web/mock environments:
    return {
      ok: true,
      action: "play",
      app_id: appId,
      name,
      command,
      pid: 12345,
    };
  }

  /**
   * Executes the terminal command sequence for `uninstallProcess`.
   */
  async executeUninstall(
    game: CatalogGame,
    record?: DigitalGameRecord,
    workingDir?: string,
  ): Promise<ProcessExecutionResult> {
    const appId = record?.id ?? game.app_id ?? game.id;
    const name = record?.name ?? game.name;
    const command = record?.uninstallProcess || "";

    if (!command.trim()) {
      throw new Error(`El juego '${name}' no tiene configurado un 'uninstallProcess' para desinstalar.`);
    }

    if (hasTauriRuntime()) {
      return invoke<ProcessExecutionResult>("run_digital_process", {
        action: "uninstall",
        appId,
        name,
        command,
        workingDir: workingDir ?? null,
      });
    }

    // In web/mock environments:
    return {
      ok: true,
      action: "uninstall",
      app_id: appId,
      name,
      command,
      exit_code: 0,
    };
  }
}

export const digitalProcessManager = new DigitalProcessManager();
