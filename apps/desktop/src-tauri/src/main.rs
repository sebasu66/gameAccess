#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::Serialize;
use std::{env, fs, path::{Path, PathBuf}, process::Command};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

#[derive(Serialize)]
struct SteamDownloadStatus {
    app_id: u32,
    state: String,
    progress: Option<f64>,
    bytes_downloaded: Option<u64>,
    bytes_total: Option<u64>,
    installed: bool,
}

#[derive(Serialize)]
struct MachineProfile {
    memory_gb: Option<f64>,
    cpu: Option<String>,
    gpus: Vec<String>,
}

fn steam_path_candidates() -> Vec<PathBuf> {
    let mut paths = Vec::new();
    if let Ok(value) = env::var("PROGRAMFILES(X86)") {
        paths.push(PathBuf::from(value).join("Steam").join("steam.exe"));
    }
    if let Ok(value) = env::var("PROGRAMFILES") {
        paths.push(PathBuf::from(value).join("Steam").join("steam.exe"));
    }
    paths.push(PathBuf::from(r"C:\Steam\steam.exe"));
    paths
}

fn find_steam_exe() -> Option<PathBuf> {
    steam_path_candidates().into_iter().find(|path| path.is_file())
}

#[tauri::command]
fn steam_installed() -> bool {
    find_steam_exe().is_some()
}

fn open_steam_uri(uri: &str) -> Result<(), String> {
    if !uri.starts_with("steam://install/") && !uri.starts_with("steam://run/") {
        return Err("Unsupported Steam URI".into());
    }

    #[cfg(target_os = "windows")]
    {
        if let Some(steam) = find_steam_exe() {
            Command::new(steam)
                .arg(uri)
                .creation_flags(CREATE_NO_WINDOW)
                .spawn()
                .map_err(|err| format!("Could not open Steam: {err}"))?;
        } else {
            Command::new("explorer.exe")
                .arg(uri)
                .creation_flags(CREATE_NO_WINDOW)
                .spawn()
                .map_err(|err| format!("Could not open Steam protocol: {err}"))?;
        }
        return Ok(());
    }

    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(uri)
            .spawn()
            .map_err(|err| format!("Could not open Steam: {err}"))?;
        return Ok(());
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        Command::new("xdg-open")
            .arg(uri)
            .spawn()
            .map_err(|err| format!("Could not open Steam: {err}"))?;
        return Ok(());
    }
}

#[tauri::command]
fn open_steam_install(app_id: u32) -> Result<(), String> {
    open_steam_uri(&format!("steam://install/{app_id}"))
}

#[tauri::command]
fn open_steam_run(app_id: u32) -> Result<(), String> {
    open_steam_uri(&format!("steam://run/{app_id}"))
}

fn quoted_value(text: &str, key: &str) -> Option<String> {
    for line in text.lines() {
        let parts: Vec<&str> = line.split('"').collect();
        if parts.len() >= 4 && parts[1].eq_ignore_ascii_case(key) {
            return Some(parts[3].replace("\\\\", "\\"));
        }
    }
    None
}

fn steam_library_roots() -> Vec<PathBuf> {
    let mut roots = Vec::new();
    if let Some(steam_exe) = find_steam_exe() {
        if let Some(root) = steam_exe.parent() {
            roots.push(root.to_path_buf());
            let libraries = root.join("steamapps").join("libraryfolders.vdf");
            if let Ok(text) = fs::read_to_string(libraries) {
                for line in text.lines() {
                    let parts: Vec<&str> = line.split('"').collect();
                    if parts.len() >= 4 && parts[1].eq_ignore_ascii_case("path") {
                        let candidate = PathBuf::from(parts[3].replace("\\\\", "\\"));
                        if !roots.iter().any(|existing| existing == &candidate) {
                            roots.push(candidate);
                        }
                    }
                }
            }
        }
    }
    roots
}

fn manifest_for(app_id: u32) -> Option<PathBuf> {
    steam_library_roots()
        .into_iter()
        .map(|root| root.join("steamapps").join(format!("appmanifest_{app_id}.acf")))
        .find(|path| path.is_file())
}

#[tauri::command]
fn steam_download_status(app_id: u32) -> SteamDownloadStatus {
    let Some(manifest) = manifest_for(app_id) else {
        return SteamDownloadStatus {
            app_id,
            state: "not-installed".into(),
            progress: None,
            bytes_downloaded: None,
            bytes_total: None,
            installed: false,
        };
    };

    let Ok(text) = fs::read_to_string(&manifest) else {
        return SteamDownloadStatus {
            app_id,
            state: "unknown".into(),
            progress: None,
            bytes_downloaded: None,
            bytes_total: None,
            installed: false,
        };
    };

    let state_flags = quoted_value(&text, "StateFlags").and_then(|v| v.parse::<u32>().ok()).unwrap_or(0);
    let bytes_total = quoted_value(&text, "BytesToDownload").and_then(|v| v.parse::<u64>().ok());
    let bytes_downloaded = quoted_value(&text, "BytesDownloaded").and_then(|v| v.parse::<u64>().ok());
    let installed = state_flags & 4 == 4;
    let progress = match (bytes_downloaded, bytes_total) {
        (Some(done), Some(total)) if total > 0 => Some(((done as f64 / total as f64) * 100.0).clamp(0.0, 100.0)),
        _ if installed => Some(100.0),
        _ => None,
    };
    let state = if installed {
        "installed"
    } else if bytes_total.unwrap_or(0) > 0 {
        "downloading"
    } else {
        "preparing"
    };

    SteamDownloadStatus {
        app_id,
        state: state.into(),
        progress,
        bytes_downloaded,
        bytes_total,
        installed,
    }
}

#[cfg(target_os = "windows")]
fn powershell_json(script: &str) -> Option<serde_json::Value> {
    let output = Command::new("powershell.exe")
        .args(["-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    serde_json::from_slice(&output.stdout).ok()
}

#[tauri::command]
fn machine_profile() -> MachineProfile {
    #[cfg(target_os = "windows")]
    {
        let script = "$cs=Get-CimInstance Win32_ComputerSystem; $cpu=(Get-CimInstance Win32_Processor | Select-Object -First 1 -ExpandProperty Name); $gpu=@(Get-CimInstance Win32_VideoController | Select-Object -ExpandProperty Name); [pscustomobject]@{memory_gb=[math]::Round($cs.TotalPhysicalMemory/1GB,1);cpu=$cpu;gpus=$gpu}|ConvertTo-Json -Compress";
        if let Some(value) = powershell_json(script) {
            let memory_gb = value.get("memory_gb").and_then(|v| v.as_f64());
            let cpu = value.get("cpu").and_then(|v| v.as_str()).map(str::to_string);
            let gpus = match value.get("gpus") {
                Some(serde_json::Value::Array(values)) => values.iter().filter_map(|v| v.as_str().map(str::to_string)).collect(),
                Some(serde_json::Value::String(value)) => vec![value.clone()],
                _ => Vec::new(),
            };
            return MachineProfile { memory_gb, cpu, gpus };
        }
    }

    MachineProfile { memory_gb: None, cpu: None, gpus: Vec::new() }
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            steam_installed,
            open_steam_install,
            open_steam_run,
            steam_download_status,
            machine_profile
        ])
        .run(tauri::generate_context!())
        .expect("error while running gameAccess");
}
