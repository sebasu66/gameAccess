from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")

def write(path: str, text: str) -> None:
    target = ROOT / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(text, encoding="utf-8", newline="\n")

def replace_once(path: str, old: str, new: str) -> None:
    text = read(path)
    if new in text:
        return
    if old not in text:
        raise RuntimeError(f"anchor not found in {path}: {old[:120]!r}")
    text = text.replace(old, new, 1)
    write(path, text)

def replace_between(path: str, start: str, end: str, replacement: str) -> None:
    text = read(path)
    if replacement.strip() in text:
        return
    begin = text.find(start)
    if begin < 0:
        raise RuntimeError(f"start anchor not found in {path}: {start!r}")
    finish = text.find(end, begin)
    if finish < 0:
        raise RuntimeError(f"end anchor not found in {path}: {end!r}")
    text = text[:begin] + replacement.rstrip() + "\n\n" + text[finish:]
    write(path, text)

NARRATION_TS = r'''import { invoke } from "@tauri-apps/api/core";

export type NarrationLevel = "INFO" | "WARN" | "ERROR";
export type NarrationOptions = {
  area?: string;
  level?: NarrationLevel;
};

const hasTauriRuntime = () =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

const cleanMessage = (value: string) => value.replace(/\s+/g, " ").trim();

let writeQueue: Promise<void> = Promise.resolve();
let logPathPromise: Promise<string | null> | null = null;

function consoleNarration(message: string, area: string, level: NarrationLevel) {
  const prefix = `[GameAccess][${area}]`;
  if (level === "ERROR") console.error(prefix, message);
  else if (level === "WARN") console.warn(prefix, message);
  else console.log(prefix, message);
}

function queueNativeWrite(task: () => Promise<unknown>): Promise<void> {
  writeQueue = writeQueue.then(async () => {
    await task();
  }).catch((error) => {
    console.warn("[GameAccess][LOG] Could not write narration log:", error);
  });
  return writeQueue;
}

export function getNarrationLogPath(): Promise<string | null> {
  if (!hasTauriRuntime()) return Promise.resolve(null);
  logPathPromise ??= invoke<string>("narration_log_path").catch(() => null);
  return logPathPromise;
}

export function narrate(message: string, options: NarrationOptions = {}): Promise<void> {
  const clean = cleanMessage(message);
  if (!clean) return Promise.resolve();
  const area = options.area ?? "APP";
  const level = options.level ?? "INFO";
  consoleNarration(clean, area, level);
  if (!hasTauriRuntime()) return Promise.resolve();
  return queueNativeWrite(() => invoke("append_narration_log", { message: clean, area, level }));
}

export function narrateBatch(messages: string[], options: NarrationOptions = {}): Promise<void> {
  const clean = messages.map(cleanMessage).filter(Boolean);
  if (!clean.length) return Promise.resolve();
  const area = options.area ?? "APP";
  const level = options.level ?? "INFO";
  for (const message of clean) consoleNarration(message, area, level);
  if (!hasTauriRuntime()) return Promise.resolve();
  return queueNativeWrite(() => invoke("append_narration_log_batch", { messages: clean, area, level }));
}

export async function startNarrationSession(build: string, initialMode: string): Promise<void> {
  const path = await getNarrationLogPath();
  await narrate("──────────────────────────────── NEW GAMEACCESS SESSION ────────────────────────────────", { area: "STARTUP" });
  await narrate(
    `Starting GameAccess desktop front end. Build: ${build || "development build"}. Initial catalog view: ${initialMode}.`,
    { area: "STARTUP" },
  );
  if (path) {
    await narrate(`Human-readable activity log is stored at ${path}.`, { area: "STARTUP" });
  } else {
    await narrate("Running without the native desktop logger; narration is available in the browser console only.", { area: "STARTUP", level: "WARN" });
  }
}
'''

TAIL_PS1 = r'''[CmdletBinding()]
param(
    [Parameter(Mandatory = $true, Position = 0)]
    [string]$Path,

    [ValidateRange(1, 100000)]
    [int]$Lines = 50,

    [switch]$FromStart
)

$ErrorActionPreference = 'Stop'

$resolved = Resolve-Path -LiteralPath $Path -ErrorAction Stop
$item = Get-Item -LiteralPath $resolved -ErrorAction Stop
if ($item.PSIsContainer) {
    throw "Tail expects a file, but '$resolved' is a directory."
}

Write-Host "Following: $resolved"
Write-Host "Press Ctrl+C to stop."
Write-Host ""

if ($FromStart) {
    Get-Content -LiteralPath $resolved -Wait
} else {
    Get-Content -LiteralPath $resolved -Tail $Lines -Wait
}
'''

TAIL_CMD = r'''@echo off
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0tail.ps1" %*
'''

write("apps/desktop/src/narrationLog.ts", NARRATION_TS)
write("tools/windows/tail.ps1", TAIL_PS1)
write("tools/windows/tail.cmd", TAIL_CMD)

replace_once(
    "apps/desktop/src-tauri/src/main.rs",
    'use std::{env, fs, path::PathBuf, process::Command, sync::Mutex};',
    'use std::{env, fs, io::Write, path::PathBuf, process::Command, sync::Mutex};',
)

RUST_LOGGER = r'''
fn narration_log_file() -> Result<PathBuf, String> {
    let base = env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(env::temp_dir);
    let directory = base.join("GameAccess").join("logs");
    fs::create_dir_all(&directory)
        .map_err(|err| format!("Could not create GameAccess log directory: {err}"))?;
    Ok(directory.join("gameaccess.log"))
}

fn clean_narration_field(value: &str, fallback: &str) -> String {
    let cleaned = value
        .replace('\r', " ")
        .replace('\n', " ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    if cleaned.is_empty() {
        fallback.to_string()
    } else {
        cleaned
    }
}

fn append_narration_lines(messages: Vec<String>, area: String, level: String) -> Result<String, String> {
    let path = narration_log_file()?;
    let safe_area = clean_narration_field(&area, "APP");
    let safe_level = clean_narration_field(&level, "INFO");
    let mut file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|err| format!("Could not open GameAccess narration log: {err}"))?;

    for message in messages {
        let clean = clean_narration_field(&message, "");
        if clean.is_empty() {
            continue;
        }
        let timestamp = chrono::Local::now().format("%Y-%m-%d %H:%M:%S%.3f");
        writeln!(file, "{timestamp} [{safe_level}] [{safe_area}] {clean}")
            .map_err(|err| format!("Could not append GameAccess narration log: {err}"))?;
    }
    file.flush()
        .map_err(|err| format!("Could not flush GameAccess narration log: {err}"))?;
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
fn narration_log_path() -> Result<String, String> {
    Ok(narration_log_file()?.to_string_lossy().to_string())
}

#[tauri::command]
fn append_narration_log(message: String, area: String, level: String) -> Result<String, String> {
    append_narration_lines(vec![message], area, level)
}

#[tauri::command]
fn append_narration_log_batch(
    messages: Vec<String>,
    area: String,
    level: String,
) -> Result<String, String> {
    append_narration_lines(messages, area, level)
}
'''

replace_once(
    "apps/desktop/src-tauri/src/main.rs",
    '#[derive(Default)]\nstruct VisualDebugState {',
    RUST_LOGGER.strip() + '\n\n#[derive(Default)]\nstruct VisualDebugState {',
)
replace_once(
    "apps/desktop/src-tauri/src/main.rs",
    '        .invoke_handler(tauri::generate_handler![\n            steam_installed,',
    '        .invoke_handler(tauri::generate_handler![\n            narration_log_path,\n            append_narration_log,\n            append_narration_log_batch,\n            steam_installed,',
)

replace_once(
    "apps/desktop/src/main.tsx",
    'import { getCatalogMode, setCatalogMode, type CatalogMode } from "./catalogMode";',
    'import { getCatalogMode, setCatalogMode, type CatalogMode } from "./catalogMode";\nimport { narrate, startNarrationSession } from "./narrationLog";',
)
replace_once(
    "apps/desktop/src/main.tsx",
    '  componentDidCatch(error: Error, info: React.ErrorInfo) { console.error("gameAccess UI crash", error, info); }',
    '  componentDidCatch(error: Error, info: React.ErrorInfo) {\n    console.error("gameAccess UI crash", error, info);\n    void narrate(`The front end crashed: ${error.message || "unknown UI error"}. React component stack: ${info.componentStack || "unavailable"}`, { area: "ERROR", level: "ERROR" });\n  }',
)
replace_once(
    "apps/desktop/src/main.tsx",
    '    if (!auxiliarySurface) captureLibraryUiState(mode);\n    setCatalogMode(next);',
    '    if (!auxiliarySurface) captureLibraryUiState(mode);\n    void narrate(`Switching catalog view from ${mode} to ${next}. This changes which availability rules are used.`, { area: "CATALOG" });\n    setCatalogMode(next);',
)
replace_once(
    "apps/desktop/src/main.tsx",
    '  const refreshCatalog = React.useCallback(() => {\n    setRefreshNonce((value) => value + 1);\n  }, []);',
    '  const refreshCatalog = React.useCallback(() => {\n    void narrate(`Manual catalog refresh requested while viewing ${mode}. The catalog will be loaded again from its source.`, { area: "CATALOG" });\n    setRefreshNonce((value) => value + 1);\n  }, [mode]);',
)
replace_once(
    "apps/desktop/src/main.tsx",
    'const root = document.getElementById("root");',
    'void startNarrationSession(import.meta.env.VITE_BUILD_TIMESTAMP ?? "", getCatalogMode());\n\nconst root = document.getElementById("root");',
)

CATALOG_FUNCTION = r'''
export function buildLocalCatalog(pool: LocalSteamPool): CatalogGame[] {
  const accounts = pool.accounts ?? [];
  const decisions: string[] = [];
  const catalog = (pool.games ?? []).flatMap((item) => {
    const owners = accounts
      .filter((account) => account.app_ids.includes(item.app_id))
      .sort((left, right) => Number(right.active) - Number(left.active));
    const accessible = accounts
      .filter((account) => account.accessible_app_ids.includes(item.app_id))
      .sort((left, right) => Number(right.active) - Number(left.active));

    if (!owners.length && !accessible.length) return [];

    const ownerLabels = owners.map((account) => account.account_name || account.label);
    const accessLabels = accessible.map((account) => account.account_name || account.label);
    const ownerText = ownerLabels.length ? ownerLabels.join(", ") : "none";
    const accessText = accessLabels.length ? accessLabels.join(", ") : "none";
    const decision = owners.length
      ? `AVAILABLE locally because the local scanner supplied at least one ownership candidate in app_ids (${ownerText}).`
      : "NOT AVAILABLE to play locally because no remembered account supplied this AppID in app_ids.";
    decisions.push(
      `${item.name} (Steam AppID ${item.app_id}). Steam-visible/access accounts from accessible_app_ids: ${accessText}. Ownership candidates currently supplied by the local scanner in app_ids: ${ownerText}. Rule applied: accessible_app_ids by itself never grants play; at least one app_ids owner candidate is required. Decision: ${decision}`,
    );

    return [{
      id: item.app_id,
      slug: `steam-${item.app_id}`,
      name: item.name,
      app_id: item.app_id,
      credit_cost_per_hour: 0,
      copies_total: owners.length,
      copies_available: owners.length,
      availability_state: owners.length ? "ready" : "unavailable",
      local_account_labels: ownerLabels,
      local_access_labels: accessLabels,
      local_primary_account_label: owners[0]?.account_name || owners[0]?.label,
      local_owner_steam_ids: owners.map((account) => account.steam_id64).filter((value): value is string => Boolean(value)),
      local_inventory_verified: pool.verification_complete,
      local_inventory_verified_at: pool.verified_at,
      ...steamAssets(item.app_id),
    }];
  });

  void narrateBatch(decisions, { area: "AVAILABILITY" });
  return catalog;
}
'''
replace_once(
    "apps/desktop/src/catalog.ts",
    'import type { LocalSteamPool } from "./native";',
    'import type { LocalSteamPool } from "./native";\nimport { narrateBatch } from "./narrationLog";',
)
replace_between(
    "apps/desktop/src/catalog.ts",
    "export function buildLocalCatalog(pool: LocalSteamPool): CatalogGame[] {",
    "export function mergeCatalog",
    CATALOG_FUNCTION,
)

replace_once(
    "apps/desktop/src/api.ts",
    'import { getCatalogMode } from "./catalogMode";',
    'import { getCatalogMode } from "./catalogMode";\nimport { narrate, narrateBatch } from "./narrationLog";',
)

LOAD_LOCAL = r'''
async function loadLocalCatalog(): Promise<CatalogGame[]> {
  await narrate(
    "Scanning local Steam data for remembered personal accounts and locally visible games. Visibility and ownership-candidate lists will be kept separate.",
    { area: "LOCAL STEAM" },
  );
  const pool = await getLocalSteamPool();
  if (!pool) {
    await narrate("The local Steam scan returned no pool. The private/local library cannot be built.", { area: "LOCAL STEAM", level: "WARN" });
    return [];
  }

  await narrate(
    `The local Steam scan found ${pool.accounts.length} remembered account(s) and ${pool.games.length} Windows game record(s). Scanner verification_complete=${pool.verification_complete}.`,
    { area: "LOCAL STEAM" },
  );
  await narrateBatch(
    pool.accounts.map((account) => {
      const label = account.account_name || account.label || "unnamed Steam account";
      return `${label}: ${account.active ? "currently active" : "remembered but not active"}; app_ids ownership candidates=${account.app_ids.length}; accessible_app_ids visibility/access entries=${account.accessible_app_ids.length}. These two lists are intentionally not treated as the same thing.`;
    }),
    { area: "LOCAL STEAM" },
  );

  localCatalog = buildLocalCatalog(pool);
  const available = localCatalog.filter((game) => game.copies_available > 0).length;
  const unavailable = localCatalog.length - available;
  await narrate(
    `Finished building the private/local library: ${localCatalog.length} visible game(s), ${available} currently marked playable, ${unavailable} visible but not playable by the current local-license rule.`,
    { area: "CATALOG" },
  );
  if (!localCatalog.length) throw new Error("Steam fue detectado pero el inventario local no devolvió juegos.");
  return localCatalog;
}
'''
replace_between(
    "apps/desktop/src/api.ts",
    "async function loadLocalCatalog(): Promise<CatalogGame[]> {",
    "const localDetails =",
    LOAD_LOCAL,
)

REQUEST_FN = r'''
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const api = await getApiBaseUrl();
  if (!api) {
    await narrate(`Backend request ${init?.method ?? "GET"} ${path} was skipped because no GameAccess server URL is configured.`, { area: "BACKEND", level: "WARN" });
    throw new Error("Online backend is not configured");
  }

  const method = init?.method ?? "GET";
  await narrate(`Sending ${method} ${path} to the GameAccess backend at ${api}.`, { area: "BACKEND" });
  const response = await fetch(`${api}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!response.ok) {
    let detail = `${response.status} ${response.statusText}`;
    try {
      const body = await response.json() as { detail?: unknown };
      if (body?.detail) detail = `${response.status} ${String(body.detail)}`;
    } catch {
      // Keep the HTTP status when the backend did not return JSON.
    }
    await narrate(`Backend request ${method} ${path} failed: ${detail}.`, { area: "BACKEND", level: "ERROR" });
    throw new Error(detail);
  }
  await narrate(`Backend request ${method} ${path} succeeded with HTTP ${response.status}.`, { area: "BACKEND" });
  return response.json() as Promise<T>;
}
'''
replace_between(
    "apps/desktop/src/api.ts",
    "async function request<T>(path: string, init?: RequestInit): Promise<T> {",
    "export async function loadHome",
    REQUEST_FN,
)

LOAD_HOME = r'''
export async function loadHome(): Promise<{ games: CatalogGame[]; user: UserSummary; offlineDemo: boolean }> {
  const mode = getCatalogMode();
  const api = await getApiBaseUrl();
  await narrate(
    `Loading the ${mode} catalog. Resolved GameAccess server: ${api || "none (offline)"}.`,
    { area: "CATALOG" },
  );

  if (mode === "local") {
    await narrate("Using the private/local Steam library. Games may be visible through Steam access even when no local ownership candidate is available.", { area: "CATALOG" });
    const games = await loadLocalCatalog();
    let user: UserSummary = { id: 1, username: "local", credits: 0 };
    if (api) {
      try { user = await request<UserSummary>("/users/1"); }
      catch { await narrate("The server user profile could not be loaded, but the private/local library can continue independently.", { area: "BACKEND", level: "WARN" }); }
    }
    return { games, user, offlineDemo: false };
  }

  if (mode === "store") {
    await narrate("Using Steam store/discovery mode. This view does not itself claim that a license is available.", { area: "CATALOG" });
    let user: UserSummary = { id: 1, username: "store", credits: 0 };
    if (api) {
      try { user = await request<UserSummary>("/users/1"); }
      catch { await narrate("The server user profile could not be loaded; store browsing remains available.", { area: "BACKEND", level: "WARN" }); }
    }
    return { games: [], user, offlineDemo: false };
  }

  if (!api) {
    await narrate("GameAccess catalog mode requires the backend, but no backend URL resolved. Showing the offline state.", { area: "BACKEND", level: "WARN" });
    return { games: [], user: { id: 1, username: "offline", credits: 0 }, offlineDemo: true };
  }

  await narrate("Requesting the shared GameAccess game catalog and current user profile from the backend.", { area: "BACKEND" });
  const [games, user] = await Promise.all([
    request<CatalogGame[]>("/catalog"),
    request<UserSummary>("/users/1").catch(() => ({ id: 1, username: "gameaccess", credits: 0 })),
  ]);
  if (!games.length) throw new Error(`GameAccess backend ${api}/catalog returned an empty catalog.`);

  void narrateBatch(
    games.map((game) => {
      const decision = game.copies_available > 0
        ? `PLAYABLE NOW because the server reports ${game.copies_available} available license copy/copies.`
        : game.copies_total > 0
          ? `NOT PLAYABLE NOW because all ${game.copies_total} known license copy/copies are currently unavailable.`
          : "NOT PLAYABLE NOW because the server reports zero license copies for this game.";
      return `${game.name}${game.app_id ? ` (Steam AppID ${game.app_id})` : ""}. Server license state: copies_total=${game.copies_total}, copies_available=${game.copies_available}, availability_state=${game.availability_state}. Decision: ${decision}`;
    }),
    { area: "AVAILABILITY" },
  );
  await narrate(`GameAccess backend catalog loaded successfully with ${games.length} game(s).`, { area: "CATALOG" });
  return { games, user, offlineDemo: false };
}
'''
replace_between(
    "apps/desktop/src/api.ts",
    "export async function loadHome(): Promise<{ games: CatalogGame[]; user: UserSummary; offlineDemo: boolean }> {",
    "export function findLocalGameForDetails",
    LOAD_HOME,
)

LEASE_FN = r'''
export const leaseGame = async (gameId: number, minutes = 60) => {
  const mode = getCatalogMode();
  await narrate(`Play requested for catalog game id ${gameId} while viewing ${mode}. Evaluating which account/license route is allowed.`, { area: "LAUNCH" });

  const game = mode === "local"
    ? localCatalog.find((item) => item.id === gameId)
    : undefined;

  if (game) {
    const configured = game.local_primary_account_label ?? game.local_account_labels?.[0];
    if (!configured) {
      await narrate(
        `${game.name}: local play was refused because no local owner candidate is configured. Being visible through Steam access is not enough.`,
        { area: "AVAILABILITY", level: "WARN" },
      );
      throw new Error("No hay una cuenta Steam local verificada que pueda abrir este juego.");
    }
    await narrate(`${game.name}: local rule selected remembered Steam account '${configured}'. Switching to that account before launch.`, { area: "ACCOUNT" });
    await switchSteamAccount(configured);
    const now = Date.now();
    await narrate(`${game.name}: local account switch completed. The local launch route is ready.`, { area: "LAUNCH" });
    return {
      lease_id: now,
      game: { id: game.id, name: game.name, app_id: game.app_id },
      account: { id: 0, label: "local", provider: "steam" },
      credits_spent: 0,
      credits_remaining: 0,
      starts_at: new Date(now).toISOString(),
      expires_at: new Date(now + minutes * 60_000).toISOString(),
      session_action: "launch_ready",
    };
  }

  if (!(await getApiBaseUrl())) {
    await narrate("GameAccess play was refused because the shared backend is not connected.", { area: "BACKEND", level: "ERROR" });
    throw new Error("El backend GameAccess no está conectado.");
  }

  await narrate("Checking whether GameAccess already has a tracked Steam game session running on this PC.", { area: "LAUNCH" });
  const session = await getSteamSessionStatus().catch(() => null);
  if (session && session.appId && !session.done && session.phase !== "idle") {
    await narrate(`Another tracked game session is still active for Steam AppID ${session.appId}. A new account/license switch is blocked until it closes.`, { area: "LAUNCH", level: "WARN" });
    throw new Error("Ya hay un juego en ejecución. Cerralo antes de iniciar otro.");
  }

  await narrate(`Requesting a GameAccess license lease for game id ${gameId}. Stale inactive leases may be replaced.`, { area: "BACKEND" });
  const lease = await request<LeaseResponse>("/leases", {
    method: "POST",
    body: JSON.stringify({ user_id: 1, game_id: gameId, minutes, replace_existing: true }),
  });
  await narrate(
    `Backend lease ${lease.lease_id} assigned account '${lease.account?.label ?? "unknown"}' with session_action='${lease.session_action}'.`,
    { area: "AVAILABILITY" },
  );
  if (lease.session_action === "provider_adapter_required") {
    if (!lease.account?.label) {
      await narrate("The backend created a lease but did not provide a Steam provider profile. Releasing the failed lease.", { area: "ERROR", level: "ERROR" });
      await releaseFailedLease(lease);
      throw new Error("La reserva no tiene un perfil Steam asociado.");
    }
    try {
      await narrate(`Preparing provider Steam account '${lease.account.label}' for the leased game. Credentials are requested securely and are never written to this log.`, { area: "ACCOUNT" });
      const credentials = await request<{ accountName: string; password: string; expectedUserId32: number }>(`/leases/${lease.lease_id}/steam-login`, { method: "POST" });
      await loginProviderSteam(credentials);
      await narrate(`Provider Steam account '${credentials.accountName}' is ready. Lease ${lease.lease_id} can launch the game.`, { area: "ACCOUNT" });
      return { ...lease, session_action: "launch_ready" };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await narrate(`Provider Steam preparation failed for lease ${lease.lease_id}: ${message}. Releasing the lease.`, { area: "ERROR", level: "ERROR" });
      await releaseFailedLease(lease);
      throw error;
    }
  }
  return lease;
};
'''
api_text = read("apps/desktop/src/api.ts")
lease_start = api_text.find("export const leaseGame = async")
if lease_start < 0:
    raise RuntimeError("leaseGame anchor not found")
if "Play requested for catalog game id" not in api_text:
    api_text = api_text[:lease_start] + LEASE_FN.strip() + "\n"
    write("apps/desktop/src/api.ts", api_text)

replace_once(
    "apps/desktop/src/native.ts",
    'import { getCatalogMode } from "./catalogMode";',
    'import { getCatalogMode } from "./catalogMode";\nimport { narrate } from "./narrationLog";',
)

LOCAL_POOL_FN = r'''
export async function getLocalSteamPool(): Promise<LocalSteamPool | null> {
  await narrate("Native layer: reading Steam remembered accounts and their local library/access data.", { area: "LOCAL STEAM" });
  try {
    const pool = hasTauriRuntime()
      ? await invoke<LocalSteamPool>("local_steam_pool")
      : await bridgeRequest<LocalSteamPool>("/local-steam-pool");
    await narrate(
      `Native Steam scan completed: ${pool.accounts.length} remembered account(s), ${pool.games.length} game record(s), source='${pool.source}'.`,
      { area: "LOCAL STEAM" },
    );
    return pool;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await narrate(`Native Steam scan failed: ${message}.`, { area: "LOCAL STEAM", level: "ERROR" });
    return null;
  }
}
'''
replace_between(
    "apps/desktop/src/native.ts",
    "export async function getLocalSteamPool(): Promise<LocalSteamPool | null> {",
    "export async function verifyLocalSteamInventory",
    LOCAL_POOL_FN,
)

WAIT_FN = r'''
async function waitForSteamInstallConfirmation(appId: number): Promise<void> {
  const deadline = Date.now() + 90_000;
  let lastState = "";
  while (Date.now() < deadline) {
    const status = await steamDownloadStatus(appId);
    if (status.state !== lastState) {
      lastState = status.state;
      await narrate(
        `Download for Steam AppID ${appId}: state changed to '${status.state}'${status.progress != null ? ` at ${Math.round(status.progress)}%` : ""}.`,
        { area: "DOWNLOAD" },
      );
    }
    if (status.error) {
      await narrate(`Download for Steam AppID ${appId} reported an error: ${status.error}.`, { area: "DOWNLOAD", level: "ERROR" });
      throw new Error(status.error);
    }
    if (status.installed) {
      await narrate(`Download for Steam AppID ${appId}: installation is complete and the game is ready on disk.`, { area: "DOWNLOAD" });
      return;
    }
    if (["preparing", "downloading", "paused"].includes(status.state)) {
      await narrate(`Steam confirmed that download work for AppID ${appId} has started.`, { area: "DOWNLOAD" });
      return;
    }
    await delay(900);
  }
  await narrate(`Steam did not confirm download start for AppID ${appId} within 90 seconds.`, { area: "DOWNLOAD", level: "ERROR" });
  throw new Error("Steam no confirmó el inicio de la descarga. La solicitud se quitó de pendientes.");
}
'''
replace_between(
    "apps/desktop/src/native.ts",
    "async function waitForSteamInstallConfirmation(appId: number): Promise<void> {",
    "export async function saveSteamCredential",
    WAIT_FN,
)

OPEN_INSTALL_FN = r'''
export async function openSteamInstall(appId: number): Promise<void> {
  if (!appId) throw new Error("Este juego todavía no tiene Steam AppID configurado.");
  const mode = getCatalogMode();
  await narrate(`Download requested for Steam AppID ${appId}. Current catalog mode is '${mode}'.`, { area: "DOWNLOAD" });
  const lifecycle = hasTauriRuntime() ? await registerDownloadJob(appId) : null;
  dispatchDownloadEvent("gameaccess:steam-download-requested", appId);
  if (!hasTauriRuntime()) {
    try {
      await narrate(`Browser/local-bridge mode: asking the local bridge to start Steam install for AppID ${appId}.`, { area: "DOWNLOAD" });
      await bridgeRequest("/open-steam-install", { method: "POST", body: JSON.stringify({ appId }) });
      await waitForSteamInstallConfirmation(appId);
    } catch {
      await narrate(`Local bridge could not start AppID ${appId}; falling back to the Steam install URI.`, { area: "DOWNLOAD", level: "WARN" });
      window.location.href = `steam://install/${appId}`;
    }
    return;
  }

  try {
    if (mode === "gameaccess") {
      await narrate(`GameAccess mode: asking the provider download manager to resolve a usable provider license and start AppID ${appId}.`, { area: "DOWNLOAD" });
      const status = await invoke<SteamDownloadStatus>("start_provider_download", { appId, jobId: lifecycle?.job_id ?? null });
      await narrate(`Provider download manager accepted AppID ${appId}${status.provider_id ? ` using provider '${status.provider_id}'` : ""}; state='${status.state}'.`, { area: "DOWNLOAD" });
      await waitForSteamInstallConfirmation(appId);
      return;
    }

    await narrate(`Private/local mode: resolving which remembered Steam account is considered the owner candidate for AppID ${appId}.`, { area: "DOWNLOAD" });
    const pool = await getLocalSteamPool();
    if (!pool) throw new Error("No se pudo leer el inventario local de licencias Steam.");
    const accountLabel = resolveSteamInstallOwner(pool.accounts, appId);
    await narrate(`Private/local download rule selected Steam account '${accountLabel}' for AppID ${appId}. Switching account before sending Steam the install request.`, { area: "ACCOUNT" });
    await switchSteamAccount(accountLabel);
    await invoke("open_steam_install", { appId });
    await narrate(`Steam install request sent for AppID ${appId}. Waiting for Steam to confirm work started.`, { area: "DOWNLOAD" });
    await waitForSteamInstallConfirmation(appId);
  } catch (error) {
    if (lifecycle) await cancelDownloadLifecycle(appId).catch(() => undefined);
    const message = error instanceof Error ? error.message : String(error);
    await narrate(`Download request for AppID ${appId} failed: ${message}.`, { area: "DOWNLOAD", level: "ERROR" });
    dispatchDownloadEvent("gameaccess:steam-download-request-failed", appId, message);
    throw error;
  }
}
'''
replace_between(
    "apps/desktop/src/native.ts",
    "export async function openSteamInstall(appId: number): Promise<void> {",
    "export async function openSteamClientInstall",
    OPEN_INSTALL_FN,
)

OPEN_CLIENT_INSTALL_FN = r'''
export async function openSteamClientInstall(appId: number): Promise<void> {
  if (!appId) throw new Error("Este juego todavía no tiene Steam AppID configurado.");
  await narrate(`Direct Steam-client download requested for AppID ${appId}. This bypasses GameAccess provider download selection.`, { area: "DOWNLOAD" });
  const lifecycle = hasTauriRuntime() ? await registerDownloadJob(appId) : null;
  dispatchDownloadEvent("gameaccess:steam-download-requested", appId);
  if (!hasTauriRuntime()) {
    try {
      await bridgeRequest("/open-steam-install", { method: "POST", body: JSON.stringify({ appId }) });
      await waitForSteamInstallConfirmation(appId);
    } catch {
      window.location.href = `steam://install/${appId}`;
    }
    return;
  }
  try {
    await invoke("open_steam_install", { appId });
    await narrate(`Steam client install URI sent for AppID ${appId}.`, { area: "DOWNLOAD" });
    await waitForSteamInstallConfirmation(appId);
  } catch (error) {
    if (lifecycle) await cancelDownloadLifecycle(appId).catch(() => undefined);
    const message = error instanceof Error ? error.message : String(error);
    await narrate(`Direct Steam-client download failed for AppID ${appId}: ${message}.`, { area: "DOWNLOAD", level: "ERROR" });
    throw error;
  }
}
'''
replace_between(
    "apps/desktop/src/native.ts",
    "export async function openSteamClientInstall(appId: number): Promise<void> {",
    "export async function openSteamRun",
    OPEN_CLIENT_INSTALL_FN,
)

OPEN_RUN_FN = r'''
export async function openSteamRun(appId: number): Promise<void> {
  if (!appId) throw new Error("Este juego todavía no tiene Steam AppID configurado.");
  await narrate(`Launch requested for Steam AppID ${appId}. Resolving the Steam account and launch route.`, { area: "LAUNCH" });
  if (!hasTauriRuntime()) {
    try {
      await bridgeRequest("/open-steam-run", { method: "POST", body: JSON.stringify({ appId }) });
      await narrate(`Local bridge accepted the launch request for AppID ${appId}.`, { area: "LAUNCH" });
    } catch {
      await narrate(`Local bridge failed for AppID ${appId}; falling back to steam://run/${appId}.`, { area: "LAUNCH", level: "WARN" });
      window.location.href = `steam://run/${appId}`;
    }
    return;
  }

  const pool = await getLocalSteamPool();
  if (!pool) {
    await narrate(`No local Steam pool was available for AppID ${appId}. Sending the run request directly to Steam without an account switch.`, { area: "LAUNCH", level: "WARN" });
    await invoke("open_steam_run", { appId });
    return;
  }

  let ownerLabel: string;
  try {
    ownerLabel = resolveSteamInstallOwner(pool.accounts, appId);
    await narrate(`Local launch rule resolved Steam account '${ownerLabel}' for AppID ${appId}.`, { area: "ACCOUNT" });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await narrate(`No local owner candidate could be resolved for AppID ${appId}: ${message}. Current code is falling back to a direct Steam run request.`, { area: "LAUNCH", level: "WARN" });
    await invoke("open_steam_run", { appId });
    return;
  }

  await narrate(`Switching Steam to '${ownerLabel}' before launching AppID ${appId}.`, { area: "ACCOUNT" });
  await switchSteamAccount(ownerLabel);
  const refreshed = await getLocalSteamPool() ?? pool;
  const owner = findSteamAccount(refreshed.accounts, ownerLabel) ?? findSteamAccount(pool.accounts, ownerLabel);
  if (!owner) {
    await narrate(`After switching, account '${ownerLabel}' could not be found in the refreshed remembered-account pool. Launch is aborted.`, { area: "ACCOUNT", level: "ERROR" });
    throw new Error(`No se pudo resolver la cuenta Steam propietaria de AppID ${appId}.`);
  }

  const preferences = loadSteamSessionPreferences();
  const previous = consumePreviousSteamAccount();
  const main = preferences.mainAccountName
    ? findSteamAccount(refreshed.accounts, preferences.mainAccountName)
    : undefined;
  const mainAccountName = main ? accountName(main) : preferences.mainAccountName;
  const restoreMode = await resolveSessionRestoreMode(
    preferences.restoreMode,
    mainAccountName,
    previous?.accountName,
  );

  await narrate(`Starting tracked Steam game session for AppID ${appId} under '${accountName(owner)}'. Restore policy after play: '${restoreMode}'.`, { area: "LAUNCH" });
  await invoke<SteamSessionStatus>("start_steam_game_session", {
    request: {
      appId,
      accountName: accountName(owner),
      expectedUserId32: owner.user_id32 ?? null,
      restoreMode,
      mainAccountName,
      mainUserId32: main?.user_id32 ?? null,
      previousAccountName: previous?.accountName ?? null,
      previousUserId32: previous?.userId32 ?? null,
    },
  });
}
'''
replace_between(
    "apps/desktop/src/native.ts",
    "export async function openSteamRun(appId: number): Promise<void> {",
    "export async function loginProviderSteam",
    OPEN_RUN_FN,
)

LOGIN_PROVIDER_FN = r'''
export async function loginProviderSteam(credentials: { accountName: string; password: string; expectedUserId32: number }): Promise<void> {
  if (!hasTauriRuntime()) throw new Error("El login de proveedores requiere la aplicación de escritorio.");
  await narrate(`Starting provider Steam login for account '${credentials.accountName}'. Password and authentication material are intentionally omitted from the log.`, { area: "ACCOUNT" });
  await invoke("login_provider_steam", credentials);
  await narrate(`Provider Steam login completed for account '${credentials.accountName}'.`, { area: "ACCOUNT" });
}
'''
replace_between(
    "apps/desktop/src/native.ts",
    "export async function loginProviderSteam(credentials: { accountName: string; password: string; expectedUserId32: number }): Promise<void> {",
    "function rememberActiveSteamAccount",
    LOGIN_PROVIDER_FN,
)

replace_once(
    "build-and-run.ps1",
    '$localApiUrl = "http://127.0.0.1:$ServerPort"',
    '''$localApiUrl = "http://127.0.0.1:$ServerPort"
$logBase = if ($env:LOCALAPPDATA) { Join-Path $env:LOCALAPPDATA 'GameAccess\\logs' } else { Join-Path $env:TEMP 'GameAccess\\logs' }
$activityLog = Join-Path $logBase 'gameaccess.log'
$tailHelperPs1 = Join-Path $projectRoot 'tools\\windows\\tail.ps1'
$tailHelperCmd = Join-Path $projectRoot 'tools\\windows\\tail.cmd'
$sebaToolsRoot = 'C:\\SebaSU_Tools' ''',
)
BUILD_HELPERS = r'''
function Write-GameAccessNarration {
    param(
        [Parameter(Mandatory = $true)][string]$Message,
        [string]$Area = 'BUILD',
        [ValidateSet('INFO', 'WARN', 'ERROR')][string]$Level = 'INFO'
    )
    New-Item -ItemType Directory -Force -Path $logBase | Out-Null
    $stamp = [DateTime]::Now.ToString('yyyy-MM-dd HH:mm:ss.fff')
    Add-Content -LiteralPath $activityLog -Value "$stamp [$Level] [$Area] $Message" -Encoding UTF8
}

function Install-SebaSUTailHelper {
    try {
        New-Item -ItemType Directory -Force -Path $sebaToolsRoot | Out-Null
        Copy-Item -LiteralPath $tailHelperPs1 -Destination (Join-Path $sebaToolsRoot 'tail.ps1') -Force
        Copy-Item -LiteralPath $tailHelperCmd -Destination (Join-Path $sebaToolsRoot 'tail.cmd') -Force
        Write-GameAccessNarration "Installed generic live-tail helper at C:\SebaSU_Tools\tail.ps1 and tail.cmd." 'TOOLS'
    } catch {
        Write-Warning "Could not install C:\SebaSU_Tools tail helper: $($_.Exception.Message)"
        Write-GameAccessNarration "Could not install the C:\SebaSU_Tools tail helper: $($_.Exception.Message)" 'TOOLS' 'WARN'
    }
}
'''
replace_once(
    "build-and-run.ps1",
    "function Get-SystemPythonCommand {",
    BUILD_HELPERS.strip() + "\n\nfunction Get-SystemPythonCommand {",
)
replace_once(
    "build-and-run.ps1",
    '    Write-Host "Preparing GameAccess server build: $buildTimestamp"',
    '    Write-GameAccessNarration "Build-and-run started. Preparing the GameAccess server and desktop client. Build timestamp: $buildTimestamp."\n    Write-Host "Preparing GameAccess server build: $buildTimestamp"',
)
replace_once(
    "build-and-run.ps1",
    '    $serverRequirementsHash = Ensure-ServerBuild',
    '    $serverRequirementsHash = Ensure-ServerBuild\n    Write-GameAccessNarration "GameAccess server source compiled and imported successfully; server dependencies are ready." "SERVER"',
)
replace_once(
    "build-and-run.ps1",
    '    Write-Host "Building Tauri release: $buildTimestamp"',
    '    Write-GameAccessNarration "Starting production build of the GameAccess desktop front end." "FRONTEND"\n    Write-Host "Building Tauri release: $buildTimestamp"',
)
replace_once(
    "build-and-run.ps1",
    '    Write-Host "Built client: $outputExe"',
    '    Write-Host "Built client: $outputExe"\n    Write-GameAccessNarration "Desktop client build completed successfully: $outputExe." "FRONTEND"\n    Install-SebaSUTailHelper',
)
replace_once(
    "build-and-run.ps1",
    '        Write-Host "Starting local GameAccess server at $localApiUrl"\n        & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $apiRestartScript -Port $ServerPort',
    '        Write-Host "Starting local GameAccess server at $localApiUrl"\n        Write-GameAccessNarration "Starting local GameAccess backend server at $localApiUrl." "SERVER"\n        & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $apiRestartScript -Port $ServerPort',
)
replace_once(
    "build-and-run.ps1",
    '        if ($LASTEXITCODE -ne 0) { throw "Local server failed to start (exit $LASTEXITCODE)." }\n    }\n    if (-not $NoRun) { Start-Process -FilePath $outputExe -WorkingDirectory $projectRoot -WindowStyle Normal }',
    '        if ($LASTEXITCODE -ne 0) { throw "Local server failed to start (exit $LASTEXITCODE)." }\n        Write-GameAccessNarration "Local GameAccess backend server is ready at $localApiUrl." "SERVER"\n    }\n    if (-not $NoRun) {\n        Write-GameAccessNarration "Starting the GameAccess desktop front end executable." "FRONTEND"\n        Start-Process -FilePath $outputExe -WorkingDirectory $projectRoot -WindowStyle Normal\n    }',
)

README_ANCHOR = "## Build and run the Windows app\n"
README_INSERT = r'''## Human-readable activity log

The desktop app writes a narration-style log intended for people, not just developers. On Windows it is stored at:

```text
%LOCALAPPDATA%\GameAccess\logs\gameaccess.log
```

It narrates front-end startup, resolved backend URL, catalog mode, remembered personal Steam accounts, local visibility vs. ownership-candidate counts, the exact rule used for each game's availability decision, GameAccess server license counts, account switching, game launch routing, and download state changes. Passwords and Steam authentication material are never written.

`build-and-run.ps1` also copies the generic live-tail helper to `C:\SebaSU_Tools\tail.ps1` and `tail.cmd` when that folder is writable. Example:

```powershell
C:\SebaSU_Tools\tail.ps1 "$env:LOCALAPPDATA\GameAccess\logs\gameaccess.log"
```

'''
replace_once("README.md", README_ANCHOR, README_INSERT + README_ANCHOR)

print("Human narration logging patch applied.")
