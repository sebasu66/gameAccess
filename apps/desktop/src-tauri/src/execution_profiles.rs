//! Execution profiles. Extracted without changing IPC contracts.
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use crate::launcher_runtime::{find_launcher_dir, launcher_data_dir};
use crate::activity_log::NARRATION_LOG_LOCK;

pub(crate) fn execution_profile_path(app_id: u32) -> Result<PathBuf, String> {
    if app_id == 0 { return Err("Invalid game identity".into()); }
    let launcher = find_launcher_dir().ok_or("Could not locate launcher")?;
    let dir = launcher_data_dir(&launcher).join(".cache").join("execution_profiles");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join(format!("{app_id}.json")))
}

#[tauri::command]
pub(crate) async fn query_cooptimus(app: tauri::AppHandle, app_id: u32, game_name: String) -> Result<serde_json::Value, String> {
    use tauri::Manager;
    if app_id == 0 || game_name.trim().is_empty() || game_name.len() > 300 { return Err("Invalid game identity".into()); }
    let label = format!("cooptimus-{}", uuid::Uuid::new_v4());
    let mut url = tauri::Url::parse("https://www.co-optimus.com/games.php").map_err(|e|e.to_string())?;
    url.query_pairs_mut().append_pair("system","4").append_pair("game-title-filter",&game_name).append_pair("playerCount","2").append_pair("countDirection","at least");
    let script = include_str!("cooptimus_lookup.js").replace("__APP_ID__",&app_id.to_string()).replace("__GAME_NAME__",&serde_json::to_string(&game_name).map_err(|e|e.to_string())?);
    let (tx,rx) = std::sync::mpsc::channel::<serde_json::Value>();
    let builder = tauri::WebviewWindowBuilder::new(&app,&label,tauri::WebviewUrl::External(url))
        .visible(false).initialization_script(&script)
        .on_navigation(move |url| {
            if url.scheme()=="gameaccess-coop" {
                if let Some((_,raw)) = url.query_pairs().find(|(key,_)| key=="data") {
                    if raw.len()<16384 {
                        if let Ok(data) = serde_json::from_str::<serde_json::Value>(&raw) {
                            if data.get("app_id").and_then(|v|v.as_u64())==Some(app_id as u64) { let _=tx.send(data); }
                        }
                    }
                }
                return false;
            }
            url.scheme()=="https" && url.host_str()==Some("www.co-optimus.com")
        });
    builder.build().map_err(|e|e.to_string())?;
    let result=tauri::async_runtime::spawn_blocking(move || rx.recv_timeout(std::time::Duration::from_secs(18))).await.map_err(|e|e.to_string())?;
    if let Some(window)=app.get_webview_window(&label) { let _=window.close(); }
    result.map_err(|_|"Co-Optimus did not return a verified game within 18 seconds".into())
}

/// Opens a Co-Optimus page in the user's default browser; the webview cannot open new windows itself.
#[tauri::command]
pub(crate) fn open_cooptimus_page(url: String) -> Result<(), String> {
    if !url.starts_with("https://www.co-optimus.com/") || url.len() > 600 || url.chars().any(|c| c.is_control() || c == ' ') {
        return Err("Only Co-Optimus pages can be opened".into());
    }
    #[cfg(target_os = "windows")]
    let mut command = {
        use std::os::windows::process::CommandExt;
        let mut command = std::process::Command::new("rundll32.exe");
        command.args(["url.dll,FileProtocolHandler", &url]).creation_flags(0x0800_0000);
        command
    };
    #[cfg(target_os = "macos")]
    let mut command = { let mut command = std::process::Command::new("open"); command.arg(&url); command };
    #[cfg(all(unix, not(target_os = "macos")))]
    let mut command = { let mut command = std::process::Command::new("xdg-open"); command.arg(&url); command };
    command.spawn().map(|_| ()).map_err(|e| e.to_string())
}

#[tauri::command]
pub(crate) fn save_execution_profile(app_id: u32, profile: serde_json::Value) -> Result<(), String> {
    let _guard = NARRATION_LOG_LOCK.get_or_init(|| Mutex::new(())).lock().map_err(|e| e.to_string())?;
    let raw = serde_json::to_vec(&profile).map_err(|e| e.to_string())?;
    if !profile.is_object() || raw.len() > 256 * 1024 { return Err("Invalid execution profile".into()); }
    let target = execution_profile_path(app_id)?;
    let temporary = target.with_extension("tmp");
    fs::write(&temporary, raw).map_err(|e| e.to_string())?;
    fs::rename(&temporary, &target).map_err(|e| e.to_string())?;
    Ok(())
}
#[tauri::command]
pub(crate) fn read_execution_profile(app_id: u32) -> Result<Option<serde_json::Value>, String> {
    let path = execution_profile_path(app_id)?;
    if !path.is_file() { return Ok(None); }
    let raw = fs::read(path).map_err(|e| e.to_string())?;
    serde_json::from_slice(&raw).map(Some).map_err(|e| e.to_string())
}
