#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod automation;
mod access_activation;
mod catalog_cache;
mod download_lifecycle;
mod game_uninstall;
mod provider_download;
mod provider_transport;
mod steam_artwork;
mod steam_session;

use gameaccess_desktop::{download_metrics, native_core};
use native_core::{
    MachineProfile, RuntimePrerequisites, SteamAccountSwitchResult, SteamDownloadStatus,
};

use serde::Serialize;
use std::{
    env, fs,
    io::Write,
    path::PathBuf,
    process::Command,
    sync::{Mutex, OnceLock},
};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

const NARRATION_LOG_MAX_BYTES: u64 = 2 * 1024 * 1024;
const NARRATION_LOG_MAX_LINE_BYTES: usize = 16 * 1024;
static NARRATION_LOG_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

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
        .replace(['\r', '\n'], " ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    if cleaned.is_empty() {
        fallback.to_string()
    } else {
        cleaned
    }
}

fn append_narration_lines(
    messages: Vec<String>,
    area: String,
    level: String,
) -> Result<String, String> {
    let _guard = NARRATION_LOG_LOCK
        .get_or_init(|| Mutex::new(()))
        .lock()
        .map_err(|_| "GameAccess narration log lock was poisoned".to_string())?;
    let path = narration_log_file()?;
    let safe_area = clean_narration_field(&area, "APP");
    let safe_level = clean_narration_field(&level, "INFO");
    for message in messages {
        let mut clean = clean_narration_field(&message, "");
        if clean.is_empty() {
            continue;
        }
        if clean.len() > NARRATION_LOG_MAX_LINE_BYTES {
            let mut end = NARRATION_LOG_MAX_LINE_BYTES;
            while !clean.is_char_boundary(end) {
                end -= 1;
            }
            clean.truncate(end);
            clean.push_str("… [truncated]");
        }
        let timestamp = chrono::Local::now().format("%Y-%m-%d %H:%M:%S%.3f");
        let line = format!("{timestamp} [{safe_level}] [{safe_area}] {clean}\n");
        let current_size = fs::metadata(&path).map(|metadata| metadata.len()).unwrap_or(0);
        if current_size.saturating_add(line.len() as u64) > NARRATION_LOG_MAX_BYTES {
            let archive = path.with_extension("log.1");
            if archive.exists() {
                fs::remove_file(&archive)
                    .map_err(|err| format!("Could not rotate old GameAccess log: {err}"))?;
            }
            if path.exists() {
                fs::rename(&path, &archive)
                    .map_err(|err| format!("Could not rotate GameAccess narration log: {err}"))?;
                if fs::metadata(&archive)
                    .map(|metadata| metadata.len())
                    .unwrap_or(0)
                    > NARRATION_LOG_MAX_BYTES
                {
                    fs::remove_file(&archive)
                        .map_err(|err| format!("Could not cap oversized archived GameAccess log: {err}"))?;
                }
            }
        }
        let mut file = fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&path)
            .map_err(|err| format!("Could not open GameAccess narration log: {err}"))?;
        file.write_all(line.as_bytes())
            .map_err(|err| format!("Could not append GameAccess narration log: {err}"))?;
        file.flush()
            .map_err(|err| format!("Could not flush GameAccess narration log: {err}"))?;
    }
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

#[derive(Default)]
struct VisualDebugState {
    session_dir: Mutex<Option<PathBuf>>,
}

#[derive(Serialize)]
struct VisualDebugConfig {
    enabled: bool,
    session_dir: Option<String>,
}

fn visual_debug_session_dir() -> Option<PathBuf> {
    let enabled = env::args().any(|arg| {
        matches!(
            arg.as_str(),
            "--visual-debug" | "-visual-debug" | "--auto-snapshot" | "-auto-snapshot"
        )
    });
    if !enabled {
        return None;
    }

    let timestamp = chrono::Local::now().format("%Y%m%d-%H%M%S").to_string();
    let project_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(|desktop| desktop.parent())
        .and_then(|apps| apps.parent())
        .map(PathBuf::from)
        .unwrap_or_else(|| env::current_dir().unwrap_or_else(|_| PathBuf::from(".")));
    let session_dir = project_root.join("debug").join("visual").join(timestamp);
    fs::create_dir_all(&session_dir).ok()?;
    Some(session_dir)
}

#[tauri::command]
fn visual_debug_config(state: tauri::State<VisualDebugState>) -> VisualDebugConfig {
    let session_dir = state
        .session_dir
        .lock()
        .ok()
        .and_then(|value| value.clone());
    VisualDebugConfig {
        enabled: session_dir.is_some(),
        session_dir: session_dir.map(|path| path.to_string_lossy().to_string()),
    }
}

fn safe_snapshot_name(label: &str) -> String {
    let cleaned: String = label
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
                ch
            } else {
                '-'
            }
        })
        .collect();
    cleaned.trim_matches('-').to_lowercase()
}

#[tauri::command]
fn capture_visual_debug(
    label: String,
    state: tauri::State<VisualDebugState>,
) -> Result<String, String> {
    let session_dir = state
        .session_dir
        .lock()
        .map_err(|_| "Visual debug state is unavailable".to_string())?
        .clone()
        .ok_or_else(|| "Visual debug mode is not enabled".to_string())?;
    let name = safe_snapshot_name(&label);
    if name.is_empty() {
        return Err("Snapshot label is empty".into());
    }
    let output_path = session_dir.join(format!("{name}.png"));

    #[cfg(target_os = "windows")]
    {
        let escaped_path = output_path.to_string_lossy().replace('\'', "''");
        let app_pid = std::process::id();
        let script = format!(
            r#"Add-Type -AssemblyName System.Drawing; Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class VisualDebugWindow {{
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  public struct RECT {{ public int Left; public int Top; public int Right; public int Bottom; }}
}}
'@; [VisualDebugWindow]::SetProcessDPIAware()|Out-Null; $h=(Get-Process -Id {app_pid}).MainWindowHandle; if($h -eq 0){{throw 'gameAccess window handle is unavailable'}}; $r=New-Object VisualDebugWindow+RECT; [VisualDebugWindow]::GetWindowRect($h,[ref]$r)|Out-Null; $w=$r.Right-$r.Left; $hgt=$r.Bottom-$r.Top; if($w -le 0 -or $hgt -le 0){{throw 'Invalid gameAccess window size'}}; $bmp=New-Object System.Drawing.Bitmap($w,$hgt); $g=[System.Drawing.Graphics]::FromImage($bmp); $g.CopyFromScreen($r.Left,$r.Top,0,0,$bmp.Size); $bmp.Save('{escaped_path}',[System.Drawing.Imaging.ImageFormat]::Png); $g.Dispose(); $bmp.Dispose()"#
        );
        let result = Command::new("powershell.exe")
            .args([
                "-NoLogo",
                "-NoProfile",
                "-ExecutionPolicy",
                "Bypass",
                "-Command",
                &script,
            ])
            .creation_flags(CREATE_NO_WINDOW)
            .output()
            .map_err(|err| format!("Could not capture visual debug snapshot: {err}"))?;
        if !result.status.success() {
            return Err(String::from_utf8_lossy(&result.stderr).trim().to_string());
        }
    }

    #[cfg(not(target_os = "windows"))]
    return Err("Visual debug capture is currently implemented for Windows".into());

    Ok(output_path.to_string_lossy().to_string())
}

#[tauri::command]
fn finish_visual_debug(
    results: serde_json::Value,
    state: tauri::State<VisualDebugState>,
) -> Result<String, String> {
    let session_dir = state
        .session_dir
        .lock()
        .map_err(|_| "Visual debug state is unavailable".to_string())?
        .clone()
        .ok_or_else(|| "Visual debug mode is not enabled".to_string())?;
    let manifest = session_dir.join("manifest.json");
    let body = serde_json::to_string_pretty(&results).map_err(|err| err.to_string())?;
    fs::write(&manifest, body)
        .map_err(|err| format!("Could not write visual debug manifest: {err}"))?;
    Ok(manifest.to_string_lossy().to_string())
}

#[tauri::command]
fn set_visual_debug_viewport(mode: String, window: tauri::Window) -> Result<(), String> {
    match mode.as_str() {
        "medium" => {
            window.unmaximize().map_err(|err| err.to_string())?;
            window
                .set_size(tauri::LogicalSize::new(1100.0, 760.0))
                .map_err(|err| err.to_string())?;
            window.center().map_err(|err| err.to_string())?;
        }
        "maximized" => window.maximize().map_err(|err| err.to_string())?,
        _ => return Err(format!("Unsupported visual debug viewport: {mode}")),
    }
    Ok(())
}

#[tauri::command]
async fn steam_installed() -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(native_core::steam_installed)
        .await
        .map_err(|err| format!("Steam detection task failed: {err}"))
}

#[tauri::command]
async fn runtime_prerequisites() -> Result<RuntimePrerequisites, String> {
    tauri::async_runtime::spawn_blocking(native_core::runtime_prerequisites)
        .await
        .map_err(|err| format!("Runtime prerequisite task failed: {err}"))
}

#[tauri::command]
fn open_steam_client() -> Result<(), String> {
    native_core::open_steam_client()
}

#[tauri::command]
fn open_steam_install(app_id: u32) -> Result<(), String> {
    native_core::open_steam_install(app_id)
}

#[tauri::command]
fn open_steam_run(app_id: u32) -> Result<(), String> {
    native_core::open_steam_run(app_id)
}

fn quoted_vdf_value(text: &str, key: &str) -> Option<String> {
    for line in text.lines() {
        let parts: Vec<&str> = line.split('"').collect();
        if parts.len() >= 4 && parts[1].eq_ignore_ascii_case(key) {
            return Some(parts[3].replace("\\\\", "\\"));
        }
    }
    None
}

fn steam_library_roots_for_folder_open() -> Result<Vec<PathBuf>, String> {
    let steam_root = native_core::runtime_prerequisites()
        .steam_path
        .map(PathBuf::from)
        .ok_or_else(|| "Steam no está instalado o no pudo ser localizado.".to_string())?;
    let mut roots = vec![steam_root.clone()];
    let library_file = steam_root.join("steamapps").join("libraryfolders.vdf");
    if let Ok(text) = fs::read_to_string(library_file) {
        for line in text.lines() {
            let parts: Vec<&str> = line.split('"').collect();
            if parts.len() < 4 || !parts[1].eq_ignore_ascii_case("path") {
                continue;
            }
            let candidate = PathBuf::from(parts[3].replace("\\\\", "\\"));
            if !roots.iter().any(|root| root == &candidate) {
                roots.push(candidate);
            }
        }
    }
    Ok(roots)
}

fn provider_prepared_game_folder(app_id: u32) -> Option<PathBuf> {
    let status = provider_download::provider_download_status(app_id)
        .ok()
        .flatten()?;
    if !(status.installed || matches!(status.state.as_str(), "installed" | "prepared")) {
        return None;
    }
    let target = PathBuf::from(status.prepared_target?);
    if !target.is_dir() {
        return None;
    }
    Some(fs::canonicalize(&target).unwrap_or(target))
}

fn installed_game_folder(app_id: u32) -> Result<PathBuf, String> {
    if let Some(folder) = provider_prepared_game_folder(app_id) {
        return Ok(folder);
    }
    for root in steam_library_roots_for_folder_open()? {
        let manifest = root
            .join("steamapps")
            .join(format!("appmanifest_{app_id}.acf"));
        let Ok(text) = fs::read_to_string(&manifest) else {
            continue;
        };
        let state_flags = quoted_vdf_value(&text, "StateFlags")
            .and_then(|value| value.parse::<u32>().ok())
            .unwrap_or(0);
        if state_flags & 4 != 4 {
            continue;
        }
        let Some(install_dir) = quoted_vdf_value(&text, "installdir") else {
            continue;
        };
        let folder = root.join("steamapps").join("common").join(install_dir);
        if folder.is_dir() {
            return Ok(fs::canonicalize(&folder).unwrap_or(folder));
        }
    }
    Err(format!(
        "GameAccess y Steam no informan una carpeta de instalación lista para AppID {app_id}."
    ))
}

#[tauri::command]
fn open_game_install_folder(app_id: u32) -> Result<String, String> {
    let folder = installed_game_folder(app_id)?;

    #[cfg(target_os = "windows")]
    Command::new("explorer.exe")
        .arg(&folder)
        .creation_flags(CREATE_NO_WINDOW)
        .spawn()
        .map_err(|err| format!("No pudimos abrir la carpeta de instalación: {err}"))?;

    #[cfg(target_os = "macos")]
    Command::new("open")
        .arg(&folder)
        .spawn()
        .map_err(|err| format!("No pudimos abrir la carpeta de instalación: {err}"))?;

    #[cfg(all(unix, not(target_os = "macos")))]
    Command::new("xdg-open")
        .arg(&folder)
        .spawn()
        .map_err(|err| format!("No pudimos abrir la carpeta de instalación: {err}"))?;

    Ok(folder.to_string_lossy().to_string())
}

#[tauri::command]
async fn steam_download_status(app_id: u32) -> Result<SteamDownloadStatus, String> {
    tauri::async_runtime::spawn_blocking(move || Ok(native_core::steam_download_status(app_id)))
    .await
    .map_err(|err| format!("Steam download-status task failed: {err}"))?
}

#[tauri::command]
async fn steam_download_metrics(app_id: u32) -> Result<download_metrics::DownloadMetrics, String> {
    tauri::async_runtime::spawn_blocking(move || download_metrics::download_metrics(app_id))
        .await
        .map_err(|err| format!("Steam download-metrics task failed: {err}"))
}

#[tauri::command]
async fn installed_app_ids() -> Result<Vec<u32>, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let mut ids = native_core::steam_installed_app_ids();
        ids.sort_unstable();
        ids.dedup();
        ids
    })
    .await
    .map_err(|err| format!("Installed-AppID scan failed: {err}"))
}

#[tauri::command]
async fn machine_profile() -> Result<MachineProfile, String> {
    tauri::async_runtime::spawn_blocking(native_core::machine_profile)
        .await
        .map_err(|err| format!("Machine-profile task failed: {err}"))
}

#[tauri::command]
async fn local_steam_pool() -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(native_core::read_local_steam_pool)
        .await
        .map_err(|err| format!("Local Steam pool task failed: {err}"))?
}

#[tauri::command]
async fn verify_local_steam_inventory() -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(native_core::verify_local_steam_inventory)
        .await
        .map_err(|err| format!("Steam inventory verification task failed: {err}"))?
}

#[tauri::command]
async fn switch_steam_account(account_label: String) -> Result<SteamAccountSwitchResult, String> {
    tauri::async_runtime::spawn_blocking(move || native_core::switch_steam_account(account_label))
        .await
        .map_err(|err| format!("Steam account-switch task failed: {err}"))
}

#[tauri::command]
async fn steam_store_metadata(app_id: u32) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || native_core::steam_store_metadata(app_id))
        .await
        .map_err(|err| format!("Steam metadata task failed: {err}"))?
}

#[tauri::command]
async fn register_download_job(
    app_id: u32,
    job_id: String,
) -> Result<download_lifecycle::DownloadJobRecord, String> {
    tauri::async_runtime::spawn_blocking(move || {
        download_lifecycle::register_download_job(app_id, job_id)
    })
    .await
    .map_err(|err| format!("Download lifecycle registration failed: {err}"))?
}

#[tauri::command]
async fn record_download_completion(
    app_id: u32,
) -> Result<Option<download_lifecycle::DownloadJobRecord>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        download_lifecycle::complete_latest_for_app(app_id)
    })
    .await
    .map_err(|err| format!("Download completion persistence failed: {err}"))?
}

#[tauri::command]
async fn acknowledge_download_completion(
    job_id: String,
) -> Result<Option<download_lifecycle::DownloadJobRecord>, String> {
    tauri::async_runtime::spawn_blocking(move || download_lifecycle::acknowledge(&job_id))
        .await
        .map_err(|err| format!("Download completion acknowledgement failed: {err}"))?
}

#[tauri::command]
async fn cancel_download_lifecycle(
    app_id: u32,
) -> Result<Option<download_lifecycle::DownloadJobRecord>, String> {
    tauri::async_runtime::spawn_blocking(move || download_lifecycle::cancel_latest_for_app(app_id))
        .await
        .map_err(|err| format!("Download lifecycle cancellation failed: {err}"))?
}

#[tauri::command]
async fn pending_download_completions() -> Result<Vec<download_lifecycle::DownloadJobRecord>, String>
{
    tauri::async_runtime::spawn_blocking(|| {
        download_lifecycle::pending_with(|app_id| {
            let steam = native_core::steam_download_status(app_id);
            if steam.installed || steam.state == "installed" {
                return true;
            }
            provider_download::provider_download_status(app_id)
                .ok()
                .flatten()
                .is_some_and(|status| {
                    (status.installed || matches!(status.state.as_str(), "installed" | "prepared"))
                        && status
                            .prepared_target
                            .as_ref()
                            .is_some_and(|target| std::path::Path::new(target).exists())
                })
        })
    })
    .await
    .map_err(|err| format!("Pending download completion scan failed: {err}"))?
}

#[tauri::command]
fn activation_installation_id() -> Result<String, String> {
    access_activation::installation_id()
}

#[tauri::command]
fn activation_read_session() -> Result<Option<String>, String> {
    access_activation::read_session()
}

#[tauri::command]
fn activation_save_session(session_token: String) -> Result<(), String> {
    access_activation::save_session(&session_token)
}

#[tauri::command]
fn activation_clear_session() -> Result<(), String> {
    access_activation::clear_session()
}

fn find_launcher_python(launcher: &std::path::Path) -> PathBuf {
    if let Some(runtime_root) = launcher.parent() {
        let embedded = runtime_root.join("python").join("python.exe");
        if embedded.is_file() {
            return embedded;
        }
    }
    let venv = launcher.join(".venv").join("Scripts").join("python.exe");
    if venv.is_file() {
        venv
    } else {
        PathBuf::from("python")
    }
}

fn find_launcher_dir() -> Option<PathBuf> {
    if let Ok(path) = env::var("GAMEACCESS_LAUNCHER_DIR") {
        let candidate = PathBuf::from(path);
        if candidate.is_dir() {
            return Some(candidate);
        }
    }
    if let Ok(exe) = env::current_exe() {
        for ancestor in exe.ancestors() {
            let candidate = ancestor.join("apps").join("launcher");
            if candidate.is_dir() {
                return Some(candidate);
            }
            let candidate2 = ancestor.join("launcher");
            if candidate2.is_dir() {
                return Some(candidate2);
            }
        }
    }
    env::current_dir().ok().and_then(|cwd| {
        for ancestor in cwd.ancestors() {
            let candidate = ancestor.join("apps").join("launcher");
            if candidate.is_dir() {
                return Some(candidate);
            }
        }
        None
    })
}

#[tauri::command]
async fn run_digital_process(
    action: String,
    app_id: u32,
    name: String,
    command: String,
    working_dir: Option<String>,
) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let launcher = find_launcher_dir().ok_or_else(|| "Could not locate launcher directory".to_string())?;
        let python = find_launcher_python(&launcher);
        let runner_script = launcher.join("digital_process_runner.py");
        let mut cmd = Command::new(&python);
        cmd.current_dir(&launcher)
            .env("PYTHONUTF8", "1")
            .env("PYTHONIOENCODING", "utf-8")
            .arg(&runner_script)
            .arg("--action")
            .arg(&action)
            .arg("--app-id")
            .arg(app_id.to_string())
            .arg("--name")
            .arg(&name)
            .arg("--command")
            .arg(&command);

        if let Some(ref cwd) = working_dir {
            cmd.arg("--working-dir").arg(cwd);
        }

        #[cfg(target_os = "windows")]
        cmd.creation_flags(CREATE_NO_WINDOW);

        let output = cmd.output().map_err(|err| format!("Failed to execute digital process runner: {err}"))?;
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if !output.status.success() && stdout.is_empty() {
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            return Err(if stderr.is_empty() { "Process execution failed".to_string() } else { stderr });
        }
        serde_json::from_str(&stdout).map_err(|err| format!("Process runner returned invalid JSON: {err} ({stdout})"))
    })
    .await
    .map_err(|err| format!("Task failed: {err}"))?
}

#[tauri::command]
async fn start_digital_download(
    app_id: u32,
    name: String,
    download_source: String,
    install_process: String,
) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let launcher = find_launcher_dir().ok_or_else(|| "Could not locate launcher directory".to_string())?;
        let python = find_launcher_python(&launcher);
        let downloader_script = launcher.join("digital_downloader.py");
        let mut cmd = Command::new(&python);
        cmd.current_dir(&launcher)
            .env("PYTHONUTF8", "1")
            .env("PYTHONIOENCODING", "utf-8")
            .arg(&downloader_script)
            .arg("--app-id")
            .arg(app_id.to_string())
            .arg("--name")
            .arg(&name);

        let src = if download_source.trim().is_empty() {
            "auto".to_string()
        } else {
            download_source
        };
        cmd.arg("--source").arg(&src);

        if !install_process.trim().is_empty() {
            cmd.arg("--install-process").arg(&install_process);
        }

        #[cfg(target_os = "windows")]
        cmd.creation_flags(CREATE_NO_WINDOW);

        let child = cmd.spawn().map_err(|err| format!("Failed to spawn digital downloader: {err}"))?;

        Ok(serde_json::json!({
            "ok": true,
            "appId": app_id,
            "pid": child.id(),
            "status": "started"
        }))
    })
    .await
    .map_err(|err| format!("Task failed: {err}"))?
}

#[tauri::command]
async fn cancel_digital_download(app_id: u32) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let launcher = find_launcher_dir().ok_or_else(|| "Could not locate launcher directory".to_string())?;
        let status_file = launcher.join(".cache").join("digital_downloads").join(format!("{app_id}.json"));
        if status_file.exists() {
            let cancel_payload = serde_json::json!({
                "type": "progress",
                "appId": app_id.to_string(),
                "phase": "cancelled",
                "progressPercent": 0.0,
                "statusText": "Instalación cancelada"
            });
            let _ = fs::write(&status_file, cancel_payload.to_string());
        }
        Ok(serde_json::json!({ "ok": true, "appId": app_id, "status": "cancelled" }))
    })
    .await
    .map_err(|err| format!("Task failed: {err}"))?
}

#[tauri::command]
async fn digital_download_status(app_id: u32) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let launcher = find_launcher_dir().ok_or_else(|| "Could not locate launcher directory".to_string())?;
        let status_file = launcher.join(".cache").join("digital_downloads").join(format!("{app_id}.json"));
        if status_file.exists() {
            let content = fs::read_to_string(&status_file).map_err(|err| err.to_string())?;
            serde_json::from_str(&content).map_err(|err| err.to_string())
        } else {
            Ok(serde_json::json!({
                "appId": app_id.to_string(),
                "phase": "preparing",
                "progressPercent": 0.0,
                "statusText": "Preparando..."
            }))
        }
    })
    .await
    .map_err(|err| format!("Task failed: {err}"))?
}

#[tauri::command]
async fn query_digital_options(name: String) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let launcher = find_launcher_dir().ok_or_else(|| "Could not locate launcher directory".to_string())?;
        let python = find_launcher_python(&launcher);
        let resolver_script = launcher.join("digital_source_resolver.py");
        let mut cmd = Command::new(&python);
        cmd.current_dir(&launcher)
            .env("PYTHONUTF8", "1")
            .env("PYTHONIOENCODING", "utf-8")
            .arg(&resolver_script)
            .arg("search")
            .arg(&name)
            .arg("--json");

        #[cfg(target_os = "windows")]
        cmd.creation_flags(CREATE_NO_WINDOW);

        let output = cmd.output().map_err(|err| format!("Failed to query digital options: {err}"))?;
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        serde_json::from_str(&stdout).map_err(|err| format!("Invalid JSON from resolver: {err} ({stdout})"))
    })
    .await
    .map_err(|err| format!("Task failed: {err}"))?
}

fn main() {
    let visual_debug_dir = visual_debug_session_dir();
    let automation_state = automation::AutomationState::from_process();
    tauri::Builder::default()
        .manage(automation_state)
        .manage(VisualDebugState {
            session_dir: Mutex::new(visual_debug_dir),
        })
        .manage(steam_session::SteamSessionState::default())
        .invoke_handler(tauri::generate_handler![
            activation_installation_id,
            activation_read_session,
            activation_save_session,
            activation_clear_session,
            catalog_cache::catalog_cache_sync,
            catalog_cache::catalog_cache_read,
            catalog_cache::catalog_cache_upsert_game,
            catalog_cache::catalog_cache_read_detail,
            catalog_cache::catalog_cache_store_detail,
            automation::automation_config,
            automation::capture_automation_screenshot,
            automation::finish_automation,
            narration_log_path,
            append_narration_log,
            append_narration_log_batch,
            steam_installed,
            runtime_prerequisites,
            open_steam_client,
            open_steam_install,
            open_steam_run,
            open_game_install_folder,
            game_uninstall::uninstall_game,
            // Freeze/thaw commands are intentionally not registered while the feature is disabled.
            steam_download_status,
            steam_download_metrics,
            installed_app_ids,
            steam_store_metadata,
            steam_artwork::steam_library_cover,
            local_steam_pool,
            verify_local_steam_inventory,
            machine_profile,
            switch_steam_account,
            register_download_job,
            record_download_completion,
            pending_download_completions,
            acknowledge_download_completion,
            cancel_download_lifecycle,
            provider_download::start_provider_download,
            provider_download::cancel_provider_download,
            provider_download::provider_download_status,
            provider_download::provider_download_statuses,
            provider_download::reconcile_download_staging,
            provider_download::discard_interrupted_download,
            provider_download::provider_download_estimate,
            steam_session::save_steam_credential,
            steam_session::remove_steam_credential,
            steam_session::has_steam_credential,
            steam_session::direct_switch_steam_account,
            provider_transport::login_provider_steam_for_lease,
            steam_session::start_steam_game_session,
            steam_session::steam_session_status,
            steam_session::steam_app_is_running,
            visual_debug_config,
            capture_visual_debug,
            finish_visual_debug,
            set_visual_debug_viewport,
            run_digital_process,
            start_digital_download,
            cancel_digital_download,
            digital_download_status,
            query_digital_options
        ])
        .run(tauri::generate_context!())
        .expect("error while running gameAccess");
}
