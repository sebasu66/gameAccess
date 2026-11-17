import { invoke } from "@tauri-apps/api/core";
import { narrate } from "../narrationLog";
import { providerAvailable } from "./PluginRuntime";
import type { PluginManifest } from "./PluginSources";
export interface ExecutionProfile {
  version: number; id?: string; name?: string; origin?: "plugin" | "manual";
  archivePasswords: string[]; beforePlay: Array<Record<string, unknown>>;
  decompressEachRun?: boolean; decompressFile?: string; executablePatterns?: string[]; runAsAdmin?: boolean;
  runSetup?: boolean | null; setupPattern?: string; setupArguments?: string[];
}
/** The editable "automation" part of a profile: what the game form and the error dialog show. */
export interface AutomationFields { decompressEachRun: boolean; decompressFile: string; executablePatterns: string[]; runAsAdmin: boolean; runSetup: boolean | null }
export const emptyAutomation: AutomationFields = { decompressEachRun: false, decompressFile: "", executablePatterns: [], runAsAdmin: false, runSetup: null };
export function parseExecutionProfile(input: unknown): ExecutionProfile {
  if (!input || typeof input !== "object") throw new Error("El perfil debe ser un objeto JSON.");
  const raw = input as Partial<ExecutionProfile>;
  const passwords = raw.archivePasswords ?? [];
  const steps = raw.beforePlay ?? [];
  if (!Array.isArray(passwords) || passwords.length > 5000 || passwords.some(p => typeof p !== "string" || p.length > 1024)) throw new Error("Contraseñas del perfil inválidas.");
  if (!Array.isArray(steps) || steps.length > 32 || steps.some(s => !s || !["ini-set","run"].includes(String(s.type)))) throw new Error("Pasos de preparación inválidos.");
  const patterns = raw.executablePatterns ?? [];
  if (!Array.isArray(patterns) || patterns.length > 32 || patterns.some(p => typeof p !== "string" || p.length > 260 || /[\\/:]|\.\./.test(p))) throw new Error("Archivos a probar inválidos.");
  return {...raw, version:1, archivePasswords:passwords, beforePlay:steps};
}
export function automationOf(profile: Partial<ExecutionProfile> | null | undefined): AutomationFields {
  return { decompressEachRun: profile?.decompressEachRun === true, decompressFile: profile?.decompressFile ?? "",
    executablePatterns: profile?.executablePatterns ?? [], runAsAdmin: profile?.runAsAdmin === true,
    runSetup: typeof profile?.runSetup === "boolean" ? profile.runSetup : null };
}
export async function loadAutomation(appId: number): Promise<AutomationFields> {
  const stored = await invoke<ExecutionProfile | null>("read_execution_profile", {appId}).catch(() => null);
  return automationOf(stored);
}
/** Saves only the automation fields; passwords, preparation steps and plugin data stay as they were. */
export async function saveAutomation(appId: number, fields: AutomationFields): Promise<ExecutionProfile> {
  const stored = await invoke<ExecutionProfile | null>("read_execution_profile", {appId}).catch(() => null);
  const patterns = fields.executablePatterns.map(p => p.trim()).filter(Boolean);
  return saveExecutionProfile(appId, {...(stored ?? {version:1,archivePasswords:[],beforePlay:[]}), ...fields, executablePatterns: patterns, origin: stored?.origin ?? "manual"});
}
export async function saveExecutionProfile(appId:number, value:unknown): Promise<ExecutionProfile> {
  const profile = parseExecutionProfile(value);
  await invoke("save_execution_profile", {appId,profile});
  void narrate("AppID " + appId + " · optional execution profile saved; " + profile.beforePlay.length + " preparation step(s).", {area:"EXECUTION_PROFILE"});
  return profile;
}
export async function ensureExecutionProfile(appId:number):Promise<ExecutionProfile> {
  const stored = await invoke<ExecutionProfile | null>("read_execution_profile", {appId}).catch(()=>null);
  if (stored) return parseExecutionProfile(stored);
  const plugins = await invoke<PluginManifest[]>("get_registered_plugins").catch(()=>[]);
  for (const plugin of (Array.isArray(plugins) ? plugins : []).filter(p=>p.type==="source_provider" && providerAvailable(p))) {
    try {
      const response = await fetch(plugin.endpoint.replace(/\/+$/,"") + "/api/execution-profile?app_id=" + appId, {signal:AbortSignal.timeout(5000)});
      if (!response.ok) continue;
      const profile = await response.json();
      if (profile) return await saveExecutionProfile(appId,{...profile,origin:"plugin"});
    } catch { /* An optional offline plugin does not block an installed game. */ }
  }
  return stored ?? {version:1,archivePasswords:[],beforePlay:[]};
}
