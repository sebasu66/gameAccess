use serde::{Deserialize, Serialize};
use std::{
    collections::hash_map::DefaultHasher,
    env, fs,
    hash::{Hash, Hasher},
    path::{Path, PathBuf},
    process::Command,
    sync::{Arc, Mutex},
    thread,
    time::{Duration, Instant},
};
use tauri::Manager;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SteamDirectSwitchResult {
    pub ok: bool,
    pub stage: String,
    pub message: String,
    pub active_user_id32: Option<u32>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SteamGameSessionRequest {
    pub app_id: u32,
    pub account_name: String,
    pub expected_user_id32: Option<u32>,
    pub restore_mode: String,
    pub main_account_name: Option<String>,
    pub main_user_id32: Option<u32>,
    pub previous_account_name: Option<String>,
    pub previous_user_id32: Option<u32>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SteamSessionStatus {
    pub phase: String,
    pub app_id: Option<u32>,
    pub account_name: Option<String>,
    pub message: String,
    pub done: bool,
    pub error: Option<String>,
}

impl Default for SteamSessionStatus {
    fn default() -> Self {
        Self {
            phase: "idle".into(),
            app_id: None,
            account_name: None,
            message: "No Steam session is active".into(),
            done: true,
            error: None,
        }
    }
}

#[derive(Default)]
pub struct SteamSessionState {
    status: Arc<Mutex<SteamSessionStatus>>,
}

fn credential_root() -> Result<PathBuf, String> {
    let local = env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .ok_or_else(|| "LOCALAPPDATA is unavailable".to_string())?;
    let root = local.join("gameAccess").join("steam-credentials");
    fs::create_dir_all(&root).map_err(|err| format!("Could not create credential storage: {err}"))?;
    Ok(root)
}

fn credential_path(account_name: &str) -> Result<PathBuf, String> {
    let normalized = account_name.trim().to_ascii_lowercase();
    if normalized.is_empty() {
        return Err("Steam account name is empty".into());
    }
    let mut hasher = DefaultHasher::new();
    normalized.hash(&mut hasher);
    Ok(credential_root()?.join(format!("{:016x}.dpapi", hasher.finish())))
}

#[cfg(target_os = "windows")]
fn powershell_secret(script: &str, env_name: &str, value: &str) -> Result<String, String> {
    let output = Command::new("powershell.exe")
        .args(["-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script])
        .env(env_name, value)
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map_err(|err| format!("Could not run Windows credential protection: {err}"))?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

#[cfg(target_os = "windows")]
fn protect_secret(secret: &str) -> Result<String, String> {
    powershell_secret(
        "Add-Type -AssemblyName System.Security; $b=[Text.Encoding]::UTF8.GetBytes($env:GAMEACCESS_STEAM_SECRET); $p=[Security.Cryptography.ProtectedData]::Protect($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Convert]::ToBase64String($p)",
        "GAMEACCESS_STEAM_SECRET",
        secret,
    )
}

#[cfg(target_os = "windows")]
fn unprotect_secret(blob: &str) -> Result<String, String> {
    powershell_secret(
        "Add-Type -AssemblyName System.Security; $b=[Convert]::FromBase64String($env:GAMEACCESS_STEAM_BLOB); $p=[Security.Cryptography.ProtectedData]::Unprotect($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Text.Encoding]::UTF8.GetString($p)",
        "GAMEACCESS_STEAM_BLOB",
        blob,
    )
}

#[tauri::command]
pub fn save_steam_credential(account_name: String, password: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        if password.is_empty() {
            return Err("Steam password is empty".into());
        }
        let encrypted = protect_secret(&password)?;
        fs::write(credential_path(&account_name)?, encrypted)
            .map_err(|err| format!("Could not save encrypted Steam credential: {err}"))?;
        Ok(())
    }
    #[cfg(not(target_os = "windows"))]
    {
        Err("Steam credential enrollment is currently implemented only on Windows".into())
    }
}

#[tauri::command]
pub fn remove_steam_credential(account_name: String) -> Result<(), String> {
    let path = credential_path(&account_name)?;
    if path.is_file() {
        fs::remove_file(path).map_err(|err| format!("Could not remove Steam credential: {err}"))?;
    }
    Ok(())
}

#[tauri::command]
pub fn has_steam_credential(account_name: String) -> Result<bool, String> {
    Ok(credential_path(&account_name)?.is_file())
}

#[cfg(target_os = "windows")]
fn load_credential(account_name: &str) -> Result<String, String> {
    let blob = fs::read_to_string(credential_path(account_name)?)
        .map_err(|_| format!("No enrolled Steam credential for {account_name}"))?;
    unprotect_secret(blob.trim())
}

#[cfg(target_os = "windows")]
fn find_steam_exe() -> Option<PathBuf> {
    let mut candidates = Vec::new();
    if let Ok(value) = env::var("PROGRAMFILES(X86)") {
        candidates.push(PathBuf::from(value).join("Steam").join("steam.exe"));
    }
    if let Ok(value) = env::var("PROGRAMFILES") {
        candidates.push(PathBuf::from(value).join("Steam").join("steam.exe"));
    }
    candidates.push(PathBuf::from(r"C:\Steam\steam.exe"));
    candidates.into_iter().find(|path| path.is_file())
}

#[cfg(target_os = "windows")]
fn registry_dword(key: &str, value_name: &str) -> Option<u32> {
    let output = Command::new("reg.exe")
        .args(["query", key, "/v", value_name])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    let needle = value_name.to_ascii_lowercase();
    let line = stdout.lines().find(|line| line.to_ascii_lowercase().contains(&needle))?;
    let raw = line.split_whitespace().last()?;
    if let Some(hex) = raw.strip_prefix("0x") {
        u32::from_str_radix(hex, 16).ok()
    } else {
        raw.parse().ok()
    }
}

#[cfg(target_os = "windows")]
fn active_user_id32() -> Option<u32> {
    registry_dword(r"HKCU\Software\Valve\Steam\ActiveProcess", "ActiveUser").filter(|value| *value > 0)
}

#[cfg(target_os = "windows")]
fn steam_app_running(app_id: u32) -> Option<bool> {
    let key = format!(r"HKCU\Software\Valve\Steam\Apps\{app_id}");
    registry_dword(&key, "Running").map(|value| value != 0)
}

#[cfg(target_os = "windows")]
fn steam_running() -> bool {
    let Ok(output) = Command::new("tasklist")
        .args(["/FI", "IMAGENAME eq steam.exe", "/NH"])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
    else {
        return false;
    };
    String::from_utf8_lossy(&output.stdout).to_ascii_lowercase().contains("steam.exe")
}

#[cfg(target_os = "windows")]
fn stop_steam(steam: &Path) {
    let _ = Command::new(steam).arg("steam://exit").creation_flags(CREATE_NO_WINDOW).spawn();
    let deadline = Instant::now() + Duration::from_secs(12);
    while Instant::now() < deadline {
        if !steam_running() {
            return;
        }
        thread::sleep(Duration::from_millis(400));
    }
    let _ = Command::new("taskkill")
        .args(["/F", "/IM", "steam.exe", "/T"])
        .creation_flags(CREATE_NO_WINDOW)
        .output();
    thread::sleep(Duration::from_secs(1));
}

#[cfg(target_os = "windows")]
fn wait_for_account(expected_user_id32: Option<u32>) -> Result<Option<u32>, String> {
    let deadline = Instant::now() + Duration::from_secs(55);
    while Instant::now() < deadline {
        let active = active_user_id32();
        if let Some(expected) = expected_user_id32 {
            if active == Some(expected) {
                return Ok(active);
            }
        } else if active.is_some() && steam_running() {
            thread::sleep(Duration::from_secs(2));
            return Ok(active);
        }
        thread::sleep(Duration::from_millis(500));
    }
    Err("Steam did not confirm the requested account before timeout".into())
}

#[cfg(target_os = "windows")]
fn direct_login(account_name: &str, expected_user_id32: Option<u32>) -> Result<Option<u32>, String> {
    if expected_user_id32.is_some() && active_user_id32() == expected_user_id32 && steam_running() {
        return Ok(expected_user_id32);
    }
    let steam = find_steam_exe().ok_or_else(|| "Steam executable was not found".to_string())?;
    let password = load_credential(account_name)?;
    stop_steam(&steam);
    Command::new(&steam)
        .args(["-login", account_name, password.as_str()])
        .creation_flags(CREATE_NO_WINDOW)
        .spawn()
        .map_err(|err| format!("Could not start Steam with the enrolled account: {err}"))?;
    wait_for_account(expected_user_id32)
}

#[tauri::command]
pub fn direct_switch_steam_account(
    account_name: String,
    expected_user_id32: Option<u32>,
) -> Result<SteamDirectSwitchResult, String> {
    #[cfg(target_os = "windows")]
    {
        let active = direct_login(account_name.trim(), expected_user_id32)?;
        Ok(SteamDirectSwitchResult {
            ok: true,
            stage: "ready".into(),
            message: format!("Steam started as {} and confirmed ActiveUser", account_name.trim()),
            active_user_id32: active,
        })
    }
    #[cfg(not(target_os = "windows"))]
    {
        Err("Direct Steam account switching is currently implemented only on Windows".into())
    }
}

#[cfg(target_os = "windows")]
fn launcher_dir() -> Option<PathBuf> {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(|desktop| desktop.parent())
        .map(|apps| apps.join("launcher"))
}

#[cfg(target_os = "windows")]
fn fallback_switch(account_name: &str) -> Result<(), String> {
    let launcher = launcher_dir().ok_or_else(|| "Could not locate the Steam UI adapter".to_string())?;
    let venv = launcher.join(".venv").join("Scripts").join("python.exe");
    let python = if venv.is_file() { venv } else { PathBuf::from("python") };
    let code = "import sys; from steam_pool import remembered_account_identities; from steam_verified_sync_v5 import deterministic_switch; t=sys.argv[1].strip().casefold(); i=next((x for x in remembered_account_identities() if str(x.get('account_name') or '').casefold()==t or str(x.get('display_name') or '').casefold()==t),None); ok,msg=(False,'Steam account is not remembered on this PC') if i is None else deterministic_switch(i); print(msg); raise SystemExit(0 if ok else 2)";
    let output = Command::new(python)
        .current_dir(launcher)
        .args(["-c", code, account_name])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map_err(|err| format!("Could not run Steam account fallback adapter: {err}"))?;
    if output.status.success() {
        return Ok(());
    }
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    Err(if stderr.is_empty() { stdout } else { stderr })
}

#[cfg(target_os = "windows")]
fn restore_account(account_name: &str, user_id32: Option<u32>) -> Result<(), String> {
    if user_id32.is_some() && active_user_id32() == user_id32 {
        return Ok(());
    }
    if credential_path(account_name)?.is_file() {
        direct_login(account_name, user_id32).map(|_| ())
    } else {
        fallback_switch(account_name)
    }
}

fn update_status(status: &Arc<Mutex<SteamSessionStatus>>, next: SteamSessionStatus) {
    if let Ok(mut guard) = status.lock() {
        *guard = next;
    }
}

fn status_for(request: &SteamGameSessionRequest, phase: &str, message: &str) -> SteamSessionStatus {
    SteamSessionStatus {
        phase: phase.into(),
        app_id: Some(request.app_id),
        account_name: Some(request.account_name.clone()),
        message: message.into(),
        done: false,
        error: None,
    }
}

#[cfg(target_os = "windows")]
fn restore_target(request: &SteamGameSessionRequest) -> Result<Option<(String, Option<u32>)>, String> {
    match request.restore_mode.as_str() {
        "main" => request
            .main_account_name
            .clone()
            .map(|name| Some((name, request.main_user_id32)))
            .ok_or_else(|| "Main-account restore is enabled but no main Steam account is configured".to_string()),
        "previous" => Ok(request.previous_account_name.clone().map(|name| (name, request.previous_user_id32))),
        "leave" => Ok(None),
        other => Err(format!("Unsupported Steam restore mode: {other}")),
    }
}

#[cfg(target_os = "windows")]
fn monitor_game(
    request: SteamGameSessionRequest,
    status: Arc<Mutex<SteamSessionStatus>>,
    app: tauri::AppHandle,
) {
    let start_deadline = Instant::now() + Duration::from_secs(180);
    let mut started = false;
    while Instant::now() < start_deadline {
        if steam_app_running(request.app_id) == Some(true) {
            started = true;
            break;
        }
        thread::sleep(Duration::from_secs(1));
    }
    if !started {
        update_status(
            &status,
            SteamSessionStatus {
                phase: "launch-unconfirmed".into(),
                app_id: Some(request.app_id),
                account_name: Some(request.account_name.clone()),
                message: "Steam never reported the game as running; automatic account restoration was skipped".into(),
                done: true,
                error: Some("Game start could not be confirmed".into()),
            },
        );
        return;
    }

    update_status(&status, status_for(&request, "running", "Steam reports the game as running"));
    let mut stopped_checks = 0;
    while stopped_checks < 5 {
        if steam_app_running(request.app_id) == Some(true) {
            stopped_checks = 0;
        } else {
            stopped_checks += 1;
        }
        thread::sleep(Duration::from_secs(1));
    }

    update_status(&status, status_for(&request, "game-exited", "Game exited; applying Steam restore preference"));
    let restore_result = restore_target(&request).and_then(|target| {
        target.map_or(Ok(()), |(name, user_id)| restore_account(&name, user_id))
    });
    let next = match restore_result {
        Ok(()) => SteamSessionStatus {
            phase: "done".into(),
            app_id: Some(request.app_id),
            account_name: Some(request.account_name.clone()),
            message: if request.restore_mode == "leave" {
                "Game exited; Steam account left unchanged".into()
            } else {
                "Game exited and Steam account restoration finished".into()
            },
            done: true,
            error: None,
        },
        Err(err) => SteamSessionStatus {
            phase: "restore-failed".into(),
            app_id: Some(request.app_id),
            account_name: Some(request.account_name.clone()),
            message: "Game exited, but Steam account restoration failed".into(),
            done: true,
            error: Some(err),
        },
    };
    update_status(&status, next);
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

#[tauri::command]
pub fn start_steam_game_session(
    request: SteamGameSessionRequest,
    state: tauri::State<SteamSessionState>,
    app: tauri::AppHandle,
) -> Result<SteamSessionStatus, String> {
    #[cfg(target_os = "windows")]
    {
        if request.app_id == 0 || request.account_name.trim().is_empty() {
            return Err("Steam session request is incomplete".into());
        }
        if let Some(expected) = request.expected_user_id32 {
            if active_user_id32() != Some(expected) {
                return Err("Steam has not confirmed the requested game owner account".into());
            }
        }
        let steam = find_steam_exe().ok_or_else(|| "Steam executable was not found".to_string())?;
        Command::new(steam)
            .arg(format!("steam://run/{}", request.app_id))
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
            .map_err(|err| format!("Could not launch Steam game: {err}"))?;

        let status = status_for(&request, "launching", "Steam launch command accepted; waiting for Running state");
        update_status(&state.status, status.clone());
        let shared = Arc::clone(&state.status);
        thread::spawn(move || monitor_game(request, shared, app));
        Ok(status)
    }
    #[cfg(not(target_os = "windows"))]
    {
        Err("Steam session monitoring is currently implemented only on Windows".into())
    }
}

#[tauri::command]
pub fn steam_session_status(state: tauri::State<SteamSessionState>) -> SteamSessionStatus {
    state.status.lock().map(|value| value.clone()).unwrap_or_default()
}
