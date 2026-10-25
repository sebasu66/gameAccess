//! Access commands. Extracted without changing IPC contracts.
use std::env;
use std::process::Command;
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;
use crate::{access_activation, access_policy};
use crate::download_queue;
use crate::launcher_runtime::{find_launcher_dir, find_launcher_python};
use crate::activity_log::append_narration_lines;

#[tauri::command]
pub(crate) async fn activation_check_access(api_url: String, session_token: String) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || access_policy::check(&api_url, &session_token)).await.map_err(|_| access_policy::UNAVAILABLE.to_string())?
}
#[tauri::command]
pub(crate) async fn create_game_shortcut(app_id: u32, name: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let launcher = find_launcher_dir().ok_or("Could not locate launcher")?;
        let executable = env::current_exe().map_err(|e|e.to_string())?;
        let mut command = Command::new(find_launcher_python(&launcher));
        command.env("PYTHONUTF8","1").env("PYTHONIOENCODING","utf-8").arg(launcher.join("game_shortcut.py"))
            .args(["--app-id",&app_id.to_string(),"--name",&name,"--launcher",&executable.to_string_lossy()]);
        #[cfg(windows)] command.creation_flags(CREATE_NO_WINDOW);
        let output = command.output().map_err(|e|e.to_string())?;
        let result: serde_json::Value = serde_json::from_slice(&output.stdout).map_err(|_|"Invalid shortcut result")?;
        if result["ok"] != true { return Err(result["error"].as_str().unwrap_or("Cannot create shortcut").into()); }
        let _ = append_narration_lines(vec![format!("AppID {app_id}: desktop shortcut points to GameAccess")],"SHORTCUT".into(),"INFO".into());
        Ok(result["path"].as_str().unwrap_or("").to_string())
    }).await.map_err(|e|e.to_string())?
}
pub(crate) fn start_access_watchdog(app: tauri::AppHandle) {
    use tauri::{Emitter, Manager};
    let foreground = app.clone();
    std::thread::spawn(move || loop {
        std::thread::sleep(std::time::Duration::from_secs(1));
        access_policy::finish_ended(|| {
            let _ = access_activation::clear_session();
            // The Download Manager pauses every pending download and starts nothing until a new activation.
            download_queue::suspend();
            let _ = append_narration_lines(vec!["GameAccess access ended; transfers paused and managed functions locked. Game processes are left running.".into()],"ACCESS".into(),"INFO".into());
            if let Some(window) = foreground.get_webview_window("main") { let _=window.set_fullscreen(false); }
            let _ = foreground.emit("gameaccess:access-ended", ());
        });
    });
    std::thread::spawn(move || loop {
        std::thread::sleep(std::time::Duration::from_secs(5));
        access_policy::refresh_due();
    });
}

// DPAPI and file access run off the window's thread.
#[tauri::command]
pub(crate) async fn activation_installation_id() -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(access_activation::installation_id).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub(crate) async fn activation_read_session() -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(access_activation::read_session).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub(crate) async fn activation_save_session(session_token: String, persistent: Option<bool>, access_key: Option<String>) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || access_activation::save_session(&session_token, persistent.unwrap_or(false), access_key)).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub(crate) async fn activation_read_key() -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(access_activation::read_key).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub(crate) fn activation_clear_session() -> Result<(), String> {
    access_policy::clear();
    access_activation::clear_session()
}
