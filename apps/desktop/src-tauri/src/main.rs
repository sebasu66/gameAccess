#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod steam_session;

use gameaccess_desktop::{local_bridge, native_core};
use native_core::{MachineProfile, RuntimePrerequisites, SteamAccountSwitchResult, SteamDownloadStatus};

use serde::Serialize;
use std::{
    env, fs,
    path::{Path, PathBuf},
    process::Command,
    sync::Mutex,
};

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
fn steam_installed() -> bool { native_core::steam_installed() }

#[tauri::command]
fn runtime_prerequisites() -> RuntimePrerequisites { native_core::runtime_prerequisites() }

#[tauri::command]
fn open_steam_client() -> Result<(), String> { native_core::open_steam_client() }

#[tauri::command]
fn open_steam_install(app_id: u32) -> Result<(), String> { native_core::open_steam_install(app_id) }

#[tauri::command]
fn open_steam_run(app_id: u32) -> Result<(), String> { native_core::open_steam_run(app_id) }

#[tauri::command]
fn steam_download_status(app_id: u32) -> SteamDownloadStatus { native_core::steam_download_status(app_id) }

#[tauri::command]
fn machine_profile() -> MachineProfile { native_core::machine_profile() }

#[tauri::command]
fn local_steam_pool() -> Result<serde_json::Value, String> { native_core::read_local_steam_pool() }

#[tauri::command]
fn verify_local_steam_inventory() -> Result<serde_json::Value, String> { native_core::verify_local_steam_inventory() }

#[tauri::command]
fn switch_steam_account(account_label: String) -> SteamAccountSwitchResult { native_core::switch_steam_account(account_label) }

#[tauri::command]
fn steam_store_metadata(app_id: u32) -> Result<serde_json::Value, String> { native_core::steam_store_metadata(app_id) }

fn main() {
    if let Err(err) = local_bridge::start() {
        eprintln!("{err}");
    }
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
            steam_download_status,
            steam_store_metadata,
            local_steam_pool,
            verify_local_steam_inventory,
            machine_profile,
            switch_steam_account,
            steam_session::save_steam_credential,
            steam_session::remove_steam_credential,
            steam_session::has_steam_credential,
            steam_session::direct_switch_steam_account,
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
