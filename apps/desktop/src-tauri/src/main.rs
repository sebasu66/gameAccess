#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod download_lifecycle;
mod provider_download;
mod steam_session;

use gameaccess_desktop::{download_metrics, native_core};
use native_core::{
    MachineProfile, RuntimePrerequisites, SteamAccountSwitchResult, SteamDownloadStatus,
};

use serde::Serialize;
use std::{env, fs, path::PathBuf, process::Command, sync::Mutex};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

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

fn installed_game_folder(app_id: u32) -> Result<PathBuf, String> {
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
            return Ok(folder);
        }
    }
    Err(format!(
        "Steam no informa una carpeta de instalación lista para AppID {app_id}."
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
    tauri::async_runtime::spawn_blocking(move || native_core::steam_download_status(app_id))
        .await
        .map_err(|err| format!("Steam download-status task failed: {err}"))
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
        ids.extend(provider_download::provider_installed_app_ids());
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
async fn register_download_job(app_id: u32, job_id: String) -> Result<download_lifecycle::DownloadJobRecord, String> {
    tauri::async_runtime::spawn_blocking(move || download_lifecycle::register_download_job(app_id, job_id))
        .await
        .map_err(|err| format!("Download lifecycle registration failed: {err}"))?
}

#[tauri::command]
async fn record_download_completion(app_id: u32) -> Result<Option<download_lifecycle::DownloadJobRecord>, String> {
    tauri::async_runtime::spawn_blocking(move || download_lifecycle::complete_latest_for_app(app_id))
        .await
        .map_err(|err| format!("Download completion persistence failed: {err}"))?
}

#[tauri::command]
async fn acknowledge_download_completion(job_id: String) -> Result<Option<download_lifecycle::DownloadJobRecord>, String> {
    tauri::async_runtime::spawn_blocking(move || download_lifecycle::acknowledge(&job_id))
        .await
        .map_err(|err| format!("Download completion acknowledgement failed: {err}"))?
}

#[tauri::command]
async fn cancel_download_lifecycle(app_id: u32) -> Result<Option<download_lifecycle::DownloadJobRecord>, String> {
    tauri::async_runtime::spawn_blocking(move || download_lifecycle::cancel_latest_for_app(app_id))
        .await
        .map_err(|err| format!("Download lifecycle cancellation failed: {err}"))?
}

#[tauri::command]
async fn pending_download_completions() -> Result<Vec<download_lifecycle::DownloadJobRecord>, String> {
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
                        && status.prepared_target.as_ref().is_some_and(|target| std::path::Path::new(target).exists())
                })
        })
    })
    .await
    .map_err(|err| format!("Pending download completion scan failed: {err}"))?
}

fn main() {
    let visual_debug_dir = visual_debug_session_dir();
    tauri::Builder::default()
        .manage(VisualDebugState {
            session_dir: Mutex::new(visual_debug_dir),
        })
        .manage(steam_session::SteamSessionState::default())
        .invoke_handler(tauri::generate_handler![
            steam_installed,
            runtime_prerequisites,
            open_steam_client,
            open_steam_install,
            open_steam_run,
            open_game_install_folder,
            steam_download_status,
            steam_download_metrics,
            installed_app_ids,
            steam_store_metadata,
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
            provider_download::provider_download_estimate,
            steam_session::save_steam_credential,
            steam_session::remove_steam_credential,
            steam_session::has_steam_credential,
            steam_session::direct_switch_steam_account,
            steam_session::login_provider_steam,
            steam_session::start_steam_game_session,
            steam_session::steam_session_status,
            visual_debug_config,
            capture_visual_debug,
            finish_visual_debug,
            set_visual_debug_viewport
        ])
        .run(tauri::generate_context!())
        .expect("error while running gameAccess");
}
