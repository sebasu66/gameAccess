import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

import { loadHome } from "./api";
import { uninstallGame } from "./gameStorage";
import { narrate } from "./narrationLog";
import { hasTauriRuntime, steamDownloadStatus } from "./native";
import type { CatalogGame } from "./types";

export type AutomationTask = {
  action: "wait" | "search" | "select" | "install" | "uninstall" | "play" | "screenshot" | "assert" | "click";
  term?: string;
  game?: string;
  app_id?: number;
  id?: number;
  label?: string;
  ms?: number;
  selector?: string;
  text?: string;
  state?: string;
  wait_for?: "accepted" | "complete" | "not-installed";
  timeout_seconds?: number;
  screenshot_after?: boolean;
};

export interface AutomationScript {
  version: 1;
  name?: string;
  stop_on_error?: boolean;
  close_when_done?: boolean;
  tasks: AutomationTask[];
}

interface AutomationConfig {
  enabled: boolean;
  script_path: string | null;
  output_dir: string | null;
  script: AutomationScript | null;
}

interface TaskResult {
  index: number;
  action: string;
  started_at: string;
  finished_at: string;
  status: "ok" | "failed";
  detail?: unknown;
  error?: string;
  screenshot?: string;
}

let automationBootStarted = false;

const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function isVisible(element: Element) {
  const node = element as HTMLElement;
  const style = window.getComputedStyle(node);
  const rect = node.getBoundingClientRect();
  return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
}

async function waitFor<T>(probe: () => T | null | undefined | false, timeoutMs: number, label: string): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown = null;
  while (Date.now() < deadline) {
    try {
      const value = probe();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await sleep(100);
  }
  const suffix = lastError ? ` Last error: ${errorMessage(lastError)}` : "";
  throw new Error(`Timed out waiting for ${label}.${suffix}`);
}

function setReactInput(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  if (setter) setter.call(input, value); else input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

async function setSearch(term: string) {
  const input = await waitFor(
    () => document.querySelector<HTMLInputElement>('.global-search input[aria-label="Buscar en tu biblioteca"]'),
    30_000,
    "Game Access search box",
  );
  input.focus();
  setReactInput(input, term);
  await sleep(350);
}

function normalize(value: string) {
  return value.trim().toLocaleLowerCase("es");
}

function resolveGame(games: CatalogGame[], task: AutomationTask, current: CatalogGame | null): CatalogGame {
  if (task.id != null) {
    const match = games.find((game) => game.id === task.id);
    if (match) return match;
  }
  if (task.app_id != null) {
    const match = games.find((game) => game.app_id === task.app_id);
    if (match) return match;
  }
  if (task.game) {
    const wanted = normalize(task.game);
    const exact = games.find((game) => normalize(game.name) === wanted);
    const partial = games.find((game) => normalize(game.name).includes(wanted));
    if (exact || partial) return exact ?? partial!;
    throw new Error(`Game '${task.game}' was not found in the loaded catalog.`);
  }
  if (current) return current;
  throw new Error(`Task '${task.action}' requires game, app_id, id, or a previously selected game.`);
}

async function selectGame(game: CatalogGame) {
  await setSearch(game.name);
  const target = await waitFor(() => {
    const candidates = Array.from(document.querySelectorAll<HTMLButtonElement>('button[aria-label^="Abrir "]'));
    return candidates.find((button) => normalize(button.getAttribute("aria-label") ?? "") === normalize(`Abrir ${game.name}`) && isVisible(button))
      ?? candidates.find((button) => normalize(button.textContent ?? "").includes(normalize(game.name)) && isVisible(button));
  }, 15_000, `selectable card for ${game.name}`);
  target.click();
  await waitFor(() => {
    const heading = document.querySelector<HTMLElement>(".detail-panel .detail-hero h1");
    return heading && normalize(heading.textContent ?? "").includes(normalize(game.name)) && isVisible(heading) ? heading : null;
  }, 15_000, `detail panel for ${game.name}`);
  await sleep(250);
}

function detailButton(pattern: RegExp) {
  return Array.from(document.querySelectorAll<HTMLButtonElement>(".detail-primary-actions button"))
    .find((button) => pattern.test(button.textContent ?? "") && isVisible(button));
}

async function waitForSteamState(appId: number, waitForState: AutomationTask["wait_for"], timeoutSeconds = 180) {
  const deadline = Date.now() + Math.max(1, timeoutSeconds) * 1000;
  let last = await steamDownloadStatus(appId);
  while (Date.now() < deadline) {
    last = await steamDownloadStatus(appId);
    if (waitForState === "not-installed") {
      if (!last.installed && last.state === "not-installed") return last;
    } else if (waitForState === "complete") {
      if (last.installed || last.state === "installed" || last.state === "prepared") return last;
    } else if (!["not-installed", "unknown"].includes(last.state)) {
      return last;
    }
    await sleep(1000);
  }
  throw new Error(`Steam AppID ${appId} did not reach '${waitForState ?? "accepted"}' in ${timeoutSeconds}s. Last state: ${last.state}.`);
}

async function capture(label: string) {
  await sleep(350);
  return invoke<string>("capture_automation_screenshot", { label });
}

async function executeTask(task: AutomationTask, games: CatalogGame[], current: CatalogGame | null): Promise<{ current: CatalogGame | null; detail?: unknown }> {
  switch (task.action) {
    case "wait":
      await sleep(Math.max(0, task.ms ?? 500));
      return { current };
    case "search":
      await setSearch(task.term ?? task.game ?? "");
      return { current, detail: { term: task.term ?? task.game ?? "" } };
    case "select": {
      const game = resolveGame(games, task, current);
      await selectGame(game);
      return { current: game, detail: { id: game.id, app_id: game.app_id, name: game.name } };
    }
    case "install": {
      const game = resolveGame(games, task, current);
      if (!game.app_id) throw new Error(`${game.name} does not have a Steam AppID.`);
      await selectGame(game);
      const button = detailButton(/Descargar|Instalado|Preparado|Preparando|%/i);
      if (!button) throw new Error(`Download action was not found for ${game.name}.`);
      if (!/Instalado|Preparado/i.test(button.textContent ?? "")) {
        if (button.disabled) throw new Error(`Download action for ${game.name} is disabled.`);
        button.click();
      }
      const status = await waitForSteamState(game.app_id, task.wait_for ?? "accepted", task.timeout_seconds ?? 180);
      return { current: game, detail: status };
    }
    case "uninstall": {
      const game = resolveGame(games, task, current);
      if (!game.app_id) throw new Error(`${game.name} does not have a Steam AppID.`);
      await uninstallGame(game.app_id);
      const status = await waitForSteamState(game.app_id, task.wait_for ?? "not-installed", task.timeout_seconds ?? 180);
      return { current: game, detail: status };
    }
    case "play": {
      const game = resolveGame(games, task, current);
      await selectGame(game);
      const button = detailButton(/Jugar ahora|Descongelar y jugar/i);
      if (!button) throw new Error(`Play action was not found for ${game.name}.`);
      if (button.disabled) throw new Error(`Play action for ${game.name} is not ready.`);
      button.click();
      await sleep(Math.max(500, task.ms ?? 2000));
      return { current: game, detail: { launched: true, app_id: game.app_id } };
    }
    case "screenshot": {
      const screenshot = await capture(task.label ?? `step-${Date.now()}`);
      return { current, detail: { screenshot } };
    }
    case "click": {
      if (!task.selector) throw new Error("click requires selector.");
      const element = await waitFor(() => {
        const candidate = document.querySelector<HTMLElement>(task.selector!);
        return candidate && isVisible(candidate) ? candidate : null;
      }, (task.timeout_seconds ?? 30) * 1000, `selector ${task.selector}`);
      element.click();
      await sleep(250);
      return { current, detail: { selector: task.selector } };
    }
    case "assert": {
      if (task.selector) {
        await waitFor(() => {
          const candidate = document.querySelector(task.selector!);
          return candidate && isVisible(candidate) ? candidate : null;
        }, (task.timeout_seconds ?? 10) * 1000, `assert selector ${task.selector}`);
      }
      if (task.text && !normalize(document.body.innerText).includes(normalize(task.text))) {
        throw new Error(`Expected visible text '${task.text}' was not found.`);
      }
      if (task.state) {
        const game = resolveGame(games, task, current);
        if (!game.app_id) throw new Error(`${game.name} does not have a Steam AppID.`);
        const status = await steamDownloadStatus(game.app_id);
        if (normalize(status.state) !== normalize(task.state)) {
          throw new Error(`Expected AppID ${game.app_id} state '${task.state}', got '${status.state}'.`);
        }
      }
      return { current, detail: { asserted: true } };
    }
    default:
      throw new Error(`Unsupported automation action: ${(task as { action?: string }).action ?? "unknown"}`);
  }
}

export async function startLocalAutomation(): Promise<void> {
  if (automationBootStarted || !hasTauriRuntime()) return;
  automationBootStarted = true;

  let config: AutomationConfig;
  try {
    config = await invoke<AutomationConfig>("automation_config");
  } catch (error) {
    console.error("GameAccess automation bootstrap failed", error);
    return;
  }
  if (!config.enabled || !config.script) return;

  const script = config.script;
  const startedAt = new Date().toISOString();
  const taskResults: TaskResult[] = [];
  let currentGame: CatalogGame | null = null;
  let overallStatus: "ok" | "failed" = "ok";
  let failure: string | null = null;

  await narrate(`Automation '${script.name ?? "unnamed"}' started from ${config.script_path ?? "local script"}.`, { area: "AUTOMATION" });

  try {
    if (script.version !== 1 || !Array.isArray(script.tasks)) {
      throw new Error("Automation script must use version 1 and contain a tasks array.");
    }
    await waitFor(
      () => document.querySelector(".app-shell") || document.querySelector(".runtime-gate"),
      45_000,
      "Game Access initial UI",
    );
    const home = await loadHome();
    const games = home.games;

    for (let index = 0; index < script.tasks.length; index += 1) {
      const task = script.tasks[index];
      const taskStarted = new Date().toISOString();
      await narrate(`Automation step ${index + 1}/${script.tasks.length}: ${task.action}.`, { area: "AUTOMATION" });
      try {
        const executed = await executeTask(task, games, currentGame);
        currentGame = executed.current;
        const result: TaskResult = {
          index,
          action: task.action,
          started_at: taskStarted,
          finished_at: new Date().toISOString(),
          status: "ok",
          detail: executed.detail,
        };
        if (task.action === "screenshot" && executed.detail && typeof executed.detail === "object" && "screenshot" in executed.detail) {
          result.screenshot = String((executed.detail as { screenshot?: unknown }).screenshot ?? "");
        }
        if (task.screenshot_after) {
          result.screenshot = await capture(`${index + 1}-${task.action}`);
        }
        taskResults.push(result);
      } catch (error) {
        const message = errorMessage(error);
        overallStatus = "failed";
        failure = message;
        let screenshot: string | undefined;
        try { screenshot = await capture(`failure-${index + 1}-${task.action}`); } catch { /* best effort */ }
        taskResults.push({
          index,
          action: task.action,
          started_at: taskStarted,
          finished_at: new Date().toISOString(),
          status: "failed",
          error: message,
          screenshot,
        });
        await narrate(`Automation step ${index + 1} failed: ${message}`, { area: "AUTOMATION", level: "ERROR" });
        if (script.stop_on_error !== false) break;
      }
    }
  } catch (error) {
    overallStatus = "failed";
    failure = errorMessage(error);
    try { await capture("automation-bootstrap-failure"); } catch { /* best effort */ }
  }

  const finishedAt = new Date().toISOString();
  try {
    await invoke<string>("finish_automation", {
      results: {
        schema_version: 1,
        name: script.name ?? null,
        status: overallStatus,
        error: failure,
        script_path: config.script_path,
        output_dir: config.output_dir,
        started_at: startedAt,
        finished_at: finishedAt,
        selected_game: currentGame ? { id: currentGame.id, app_id: currentGame.app_id, name: currentGame.name } : null,
        tasks: taskResults,
      },
    });
    await narrate(`Automation '${script.name ?? "unnamed"}' finished with status '${overallStatus}'.`, {
      area: "AUTOMATION",
      level: overallStatus === "ok" ? "INFO" : "ERROR",
    });
  } catch (error) {
    console.error("Could not persist GameAccess automation result", error);
  }

  if (script.close_when_done) {
    await sleep(600);
    await getCurrentWindow().close().catch(() => undefined);
  }
}
