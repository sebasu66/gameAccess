#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{env, path::PathBuf, process::Command};

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

#[tauri::command]
fn steam_installed() -> bool {
    steam_path_candidates().into_iter().any(|path| path.is_file())
}

fn open_steam_uri(uri: &str) -> Result<(), String> {
    if !uri.starts_with("steam://install/") && !uri.starts_with("steam://run/") {
        return Err("Unsupported Steam URI".into());
    }

    #[cfg(target_os = "windows")]
    {
        Command::new("cmd")
            .args(["/C", "start", "", uri])
            .spawn()
            .map_err(|err| format!("Could not open Steam: {err}"))?;
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

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            steam_installed,
            open_steam_install,
            open_steam_run
        ])
        .run(tauri::generate_context!())
        .expect("error while running gameAccess");
}
