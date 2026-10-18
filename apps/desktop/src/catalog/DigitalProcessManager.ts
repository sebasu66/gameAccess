import { invoke } from "@tauri-apps/api/core";
import { narrate } from "../narrationLog";
import { getSteamStoreLanguage } from "../i18n";
import { ensureExecutionProfile } from "./ExecutionProfiles";
import type { CatalogGame } from "../types";
import type { DigitalGameRecord } from "./DigitalCatalog";

export interface ProcessExecutionResult {
  ok: boolean;
  action: "play" | "uninstall" | "status" | "snapshot" | "open-folder" | "settings" | "save-settings" | "local-games" | "game-options" | "save-game-options" | "repair-language" | "install-setup" | "game-log" | "game-analyze" | "game-repair" | "import-drives" | "import-scan" | "import-run" | "library-list" | "library-plan" | "library-space" | "library-batch";
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
  settings?: DigitalStorageSettings;
  options?: DigitalLaunchOptions;
  executables?: string[];
  archives?: string[];
  changed?: string[];
  log?: string;
  analysis?: GameAnalysis;
  library?: LibraryGame[];
  drives?: ImportDrive[];
  candidates?: ImportCandidate[];
  transfers?: LibraryTransfer[];
  usage?: LibraryUsage;
  plans?: LibraryPlan[];
  summary?: LibrarySummary;
  space?: LibrarySpace;
  results?: Array<{ app_id: number; ok: boolean; error?: string }>;
  file?: string;
  needs_repair?: boolean;
  errors?: Array<{file: string; error: string}>;
  games?: Array<{id: number; name: string}>;
  statuses?: Record<string, { folder: string; installed: boolean }>;
}

export interface ImportDrive { path: string; label: string; total_bytes: number; free_bytes: number }
export interface ImportCandidate { id: string; name: string; path: string; kind: "steam" | "folder"; source: "steam" | "library" | "downloads"; app_id: number | null; size_bytes: number; executable: string; can_move: boolean }
export interface ImportItem { app_id: number; name: string; path: string; mode: "link" | "move"; kind: "steam" | "folder"; executable: string }
export interface LibraryUsage { by_day: Record<string, number>; by_month: Record<string, number> }
export interface LibraryPlanAction { code: string; label: string; bytes?: number }
export interface LibraryPlan { app_id: number; name: string; actions: LibraryPlanAction[]; freed_bytes?: number; delete_sources?: boolean; error?: string }
export interface LibraryIssue { code: string; message: string; bytes?: number }
export interface LibraryTransfer { app_id: number; name: string; folder: string; active: boolean; size_bytes: number | null }
export interface LibraryGame { app_id: number | null; issues: LibraryIssue[]; standard: boolean; reclaimable_bytes: number; transfer_bytes: number | null; transfer_active: boolean; partial?: boolean; unfinished?: boolean; transfer_kind?: "pieces" | "other" | ""; name: string; state: string; folder: string; installed: boolean; needs_repair: boolean; error: string; warning: string; size_bytes: number | null; plays?: number; last_played?: string; linked?: boolean; link_kind?: "steam" | "folder" }
export interface LibrarySummary { count: number; by_state: Record<string, number>; needs_repair: number; nonstandard: number; partial_downloads: number; used_bytes: number; transfers_bytes: number; reclaimable_bytes: number; disk_free_bytes?: number; disk_total_bytes?: number; linked_count?: number; linked_bytes?: number }
export interface LibrarySpace { ok: boolean; needed_bytes: number; free_bytes: number; message: string }
export type LibraryBatchAction = "uninstall" | "repair" | "analyze" | "adopt" | "discard_transfer";
export interface GameAnalysis { state: "empty" | "extract" | "setup" | "blocked" | "ready"; ready: boolean; warning: string; needs: string[]; executable: string }
export interface DigitalStorageSettings { games_root: string; temporary_root: string; previous_roots: string[]; delete_download_sources?: boolean }
export interface DigitalLaunchOptions { executable: string; arguments: string; administrator: boolean; language: string; backupEnabled?: boolean; backupArchive?: string }

const hasTauriRuntime = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/**
 * Dedicated Process Manager for the Digital tab.
 *
 * Runs the dedicated Digital folder lifecycle and resolves a local game executable
 * by passing them to the Python process runner (`digital_process_runner.py`) via Tauri.
 */
export class DigitalProcessManager {
  private snapshotPending: Promise<ProcessExecutionResult> | null = null;
  executePlay(game: CatalogGame, record?: DigitalGameRecord, workingDir?: string): Promise<ProcessExecutionResult> {
    return this.execute("play", game, record, workingDir);
  }

  executeUninstall(game: CatalogGame, record?: DigitalGameRecord, workingDir?: string): Promise<ProcessExecutionResult> {
    return this.execute("uninstall", game, record, workingDir);
  }

  status(game: CatalogGame): Promise<ProcessExecutionResult> { return this.execute("status", game); }

  openFolder(game: CatalogGame): Promise<ProcessExecutionResult> { return this.execute("open-folder", game); }

  settings() { return this.execute("settings", {id:0,name:""} as CatalogGame); }
  saveSettings(values: DigitalStorageSettings) { return this.execute("save-settings", {id:0,name:""} as CatalogGame, undefined, undefined, JSON.stringify(values)); }
  localGames() { return this.execute("local-games", {id:0,name:""} as CatalogGame); }
  gameOptions(game: CatalogGame) { return this.execute("game-options", game); }
  saveGameOptions(game: CatalogGame, options: DigitalLaunchOptions) { return this.execute("save-game-options", game, undefined, undefined, JSON.stringify(options)); }
  analyzeGame(game: CatalogGame) { return this.execute("game-analyze", game); }
  repairGame(game: CatalogGame) { return this.execute("game-repair", game); }
  gameLog(game: CatalogGame) { return this.execute("game-log", game); }
  libraryList() { return this.execute("library-list", {id:0,name:""} as CatalogGame); }
  libraryPlan(appIds: number[]) { return this.execute("library-plan", {id:0,name:""} as CatalogGame, undefined, undefined, JSON.stringify({ app_ids: appIds })); }
  librarySpace(bytes: number) { return this.execute("library-space", {id:0,name:""} as CatalogGame, undefined, undefined, JSON.stringify({ bytes })); }
  libraryBatch(action: LibraryBatchAction, appIds: number[]) { return this.execute("library-batch", {id:0,name:""} as CatalogGame, undefined, undefined, JSON.stringify({ action, app_ids: appIds })); }
  importDrives() { return this.execute("import-drives", {id:0,name:""} as CatalogGame); }
  importScan(drives: string[]) { return this.execute("import-scan", {id:0,name:""} as CatalogGame, undefined, undefined, JSON.stringify({ drives })); }
  importRun(items: ImportItem[]) { return this.execute("import-run", {id:0,name:""} as CatalogGame, undefined, undefined, JSON.stringify({ items })); }
  repairLanguage(game: CatalogGame) { return this.execute("repair-language", game); }

  snapshot(games: CatalogGame[]): Promise<ProcessExecutionResult> {
    // Keep one native query even if callers change or a view is remounted.
    if (this.snapshotPending) return this.snapshotPending;
    const pending = this.execute("snapshot", { id: 0, app_id: 0, name: "" } as CatalogGame, undefined, undefined, JSON.stringify(games.map(g => ({ id: g.app_id ?? g.id, name: g.name }))));
    this.snapshotPending = pending;
    const clear = () => { if (this.snapshotPending === pending) this.snapshotPending = null; };
    void pending.then(clear, clear);
    return pending;
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
          await ensureExecutionProfile(appId);
        }
        const result = await invoke<ProcessExecutionResult>("run_digital_process", {
          action, appId, name, command, workingDir: null, autoInstalled, language: getSteamStoreLanguage(),
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
