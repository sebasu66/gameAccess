//! Steam commands. Extracted without changing IPC contracts.
use std::fs;
use std::path::PathBuf;
use std::process::Command;
use gameaccess_desktop::native_core;
use gameaccess_desktop::download_metrics;
use gameaccess_desktop::steam_metadata_worker;
use gameaccess_desktop::native_core::{MachineProfile, RuntimePrerequisites, SteamDownloadStatus};
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;
use crate::launcher_runtime::find_launcher_dir;

#[tauri::command]
pub(crate) async fn steam_installed() -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(native_core::steam_installed)
        .await
        .map_err(|err| format!("Steam detection task failed: {err}"))
}

#[tauri::command]
pub(crate) async fn runtime_prerequisites() -> Result<RuntimePrerequisites, String> {
    tauri::async_runtime::spawn_blocking(native_core::runtime_prerequisites)
        .await
        .map_err(|err| format!("Runtime prerequisite task failed: {err}"))
}

#[tauri::command]
pub(crate) fn open_steam_client() -> Result<(), String> {
    native_core::open_steam_client()
}

#[tauri::command]
pub(crate) fn open_steam_install(app_id: u32) -> Result<(), String> {
    native_core::open_steam_install(app_id)
}

#[tauri::command]
pub(crate) fn open_steam_run(app_id: u32) -> Result<(), String> {
    native_core::open_steam_run(app_id)
}

#[tauri::command]
pub(crate) fn open_steam_store(app_id: u32) -> Result<(), String> {
    native_core::open_steam_store(app_id)
}

pub(crate) fn quoted_vdf_value(text: &str, key: &str) -> Option<String> {
    for line in text.lines() {
        let parts: Vec<&str> = line.split('"').collect();
        if parts.len() >= 4 && parts[1].eq_ignore_ascii_case(key) {
            return Some(parts[3].replace("\\\\", "\\"));
        }
    }
    None
}

pub(crate) fn steam_library_roots_for_folder_open() -> Result<Vec<PathBuf>, String> {
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


pub(crate) fn installed_game_folder(app_id: u32) -> Result<PathBuf, String> {
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
pub(crate) fn open_game_install_folder(app_id: u32) -> Result<String, String> {
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
pub(crate) async fn steam_download_status(app_id: u32) -> Result<SteamDownloadStatus, String> {
    tauri::async_runtime::spawn_blocking(move || Ok(native_core::steam_download_status(app_id)))
    .await
    .map_err(|err| format!("Steam download-status task failed: {err}"))?
}

#[tauri::command]
pub(crate) async fn steam_download_metrics(app_id: u32) -> Result<download_metrics::DownloadMetrics, String> {
    tauri::async_runtime::spawn_blocking(move || download_metrics::download_metrics(app_id))
        .await
        .map_err(|err| format!("Steam download-metrics task failed: {err}"))
}

#[tauri::command]
pub(crate) async fn installed_app_ids() -> Result<Vec<u32>, String> {
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
pub(crate) async fn machine_profile() -> Result<MachineProfile, String> {
    tauri::async_runtime::spawn_blocking(native_core::machine_profile)
        .await
        .map_err(|err| format!("Machine-profile task failed: {err}"))
}




#[tauri::command]
pub(crate) async fn steam_store_metadata(app_id: u32, language: Option<String>, force: Option<bool>) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || native_core::steam_store_metadata_refresh(app_id, language, force.unwrap_or(false)))
        .await
        .map_err(|err| format!("Steam metadata task failed: {err}"))?
}

#[tauri::command]
pub(crate) async fn steam_metadata_worker_start(app_ids: Vec<u32>) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let roots = find_launcher_dir().map(|path| vec![path.join("games")]).unwrap_or_default();
        steam_metadata_worker::start(app_ids, roots);
    }).await.map_err(|err| err.to_string())
}

#[tauri::command]
pub(crate) async fn steam_metadata_worker_poll() -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(steam_metadata_worker::poll).await.map_err(|err| err.to_string())
}

#[tauri::command]
pub(crate) async fn steam_metadata_catalog_cache(app_ids: Vec<u32>) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || native_core::steam_metadata_catalog_cache(&app_ids)).await.map_err(|err| err.to_string())
}
