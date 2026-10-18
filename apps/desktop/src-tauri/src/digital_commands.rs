//! Digital commands. Extracted without changing IPC contracts.
use std::env;
use std::fs;
use std::process::Command;
use std::sync::Mutex;
use std::sync::OnceLock;
use std::io::{Write};
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;
use crate::launcher_runtime::{find_launcher_dir, find_launcher_python};
use crate::activity_log::append_narration_lines;

#[tauri::command]
pub(crate) async fn run_digital_process(
    action: String,
    app_id: u32,
    name: String,
    command: String,
    working_dir: Option<String>,
    auto_installed: Option<bool>,
    language: Option<String>,
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
            .arg(if action == "snapshot" { "" } else { &command });
        if action == "snapshot" {
            cmd.stdin(std::process::Stdio::piped()).stdout(std::process::Stdio::piped()).stderr(std::process::Stdio::piped());
        }

        if auto_installed == Some(true) { cmd.arg("--auto-installed"); }
        // The app's language: games that follow it get their INI language set to it before play.
        if let Some(language) = language.as_deref().map(str::trim).filter(|value| !value.is_empty() && value.chars().all(|c| c.is_ascii_alphabetic())) {
            cmd.env("GAMEACCESS_APP_LANGUAGE", language);
        }
        if let Some(ref cwd) = working_dir {
            cmd.arg("--working-dir").arg(cwd);
        }

        #[cfg(target_os = "windows")]
        cmd.creation_flags(CREATE_NO_WINDOW);

        let output = if action == "snapshot" {
            let mut child = cmd.spawn().map_err(|err| format!("Failed to execute digital process runner: {err}"))?;
            child.stdin.take().ok_or_else(|| "Missing Digital snapshot input".to_string())?
                .write_all(command.as_bytes()).map_err(|err| err.to_string())?;
            child.wait_with_output().map_err(|err| err.to_string())?
        } else {
            cmd.output().map_err(|err| format!("Failed to execute digital process runner: {err}"))?
        };
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

static DIGITAL_DOWNLOAD_PIDS: OnceLock<Mutex<std::collections::HashMap<u32, u32>>> = OnceLock::new();

pub(crate) fn digital_pids() -> &'static Mutex<std::collections::HashMap<u32, u32>> {
    DIGITAL_DOWNLOAD_PIDS.get_or_init(|| Mutex::new(std::collections::HashMap::new()))
}

#[tauri::command]
pub(crate) async fn start_digital_download(
    app_id: u32,
    name: String,
    download_source: String,
    source_delivery: Option<String>,
    install_process: String,
    torbox_key: Option<String>,
    chunk_session: Option<String>,
    keep_archive: Option<bool>,
    auto_installed: Option<bool>,
) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _ = append_narration_lines(vec![format!("AppID {app_id}: starting generic download for {name}")], "DOWNLOAD".into(), "INFO".into());
        let launcher = find_launcher_dir().ok_or_else(|| {
            let err = "Could not locate launcher directory".to_string();
            eprintln!("[Rust:start_digital_download:Error] {err}");
            err
        })?;
        let python = find_launcher_python(&launcher);
        let downloader_script = launcher.join("digital_downloader.py");
        println!("[Rust:start_digital_download] Using launcher={launcher:?}, python={python:?}, script={downloader_script:?}");

        if !downloader_script.is_file() {
            let err = format!("Downloader script not found at {downloader_script:?}");
            eprintln!("[Rust:start_digital_download:Error] {err}");
            return Err(err);
        }

        let status_dir = launcher.join(".cache").join("digital_downloads");
        fs::create_dir_all(&status_dir).map_err(|err| err.to_string())?;
        for suffix in ["json", "control.json", "passwords.json", "passwords.tmp"] {
            let path = status_dir.join(format!("{app_id}.{suffix}"));
            if path.exists() { fs::remove_file(path).map_err(|err| err.to_string())?; }
        }
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
        if source_delivery.as_deref() == Some("browser") { cmd.arg("--source-delivery").arg("browser"); }

        // Digital archives are extracted in place; catalog installation commands are ignored.
        let _ = install_process;

        if let Some(ref key) = torbox_key {
            if !key.trim().is_empty() {
                cmd.arg("--torbox-key").arg(key.trim());
            }
        }

        // Credentials for the piece-by-piece download travel in the environment, not in the command line.
        if let Some(ref session) = chunk_session {
            if !session.trim().is_empty() {
                cmd.env("GAMEACCESS_CHUNK_SESSION", session.trim());
            }
        }

        if auto_installed == Some(true) { cmd.arg("--auto-installed"); }
        if keep_archive == Some(true) {
            cmd.arg("--keep-archive");
        }

        #[cfg(target_os = "windows")]
        cmd.creation_flags(CREATE_NO_WINDOW);

        let _ = append_narration_lines(vec![format!("AppID {app_id}: download worker starting")], "DOWNLOAD".into(), "INFO".into());
        let child = cmd.spawn().map_err(|err| {
            let err_str = format!("Failed to spawn digital downloader: {err}");
            eprintln!("[Rust:start_digital_download:Error] {err_str}");
            err_str
        })?;

        let pid = child.id();
        println!("[Rust:start_digital_download] Successfully spawned PID {}", pid);
        if let Ok(mut map) = digital_pids().lock() {
            map.insert(app_id, pid);
        }
        Ok(serde_json::json!({
            "ok": true,
            "appId": app_id,
            "pid": pid,
            "status": "started"
        }))
    })
    .await
    .map_err(|err| format!("Task failed: {err}"))?
}

pub(crate) fn write_digital_control(app_id: u32, action: &str) -> Result<std::path::PathBuf, String> {
    let launcher = find_launcher_dir().ok_or_else(|| "Could not locate launcher directory".to_string())?;
    let dir = launcher.join(".cache").join("digital_downloads");
    fs::create_dir_all(&dir).map_err(|err| err.to_string())?;
    let control = serde_json::json!({ "action": action, "requestId": uuid::Uuid::new_v4().to_string() });
    let path = dir.join(format!("{app_id}.control.json"));
    let temp = dir.join(format!("{app_id}.control.tmp"));
    fs::write(&temp, control.to_string()).map_err(|err| err.to_string())?;
    for attempt in 0..20 {
        match fs::rename(&temp, &path) {
            Ok(()) => break,
            Err(err) if err.kind() == std::io::ErrorKind::PermissionDenied && attempt < 19 =>
                std::thread::sleep(std::time::Duration::from_millis(50)),
            Err(err) => return Err(err.to_string()),
        }
    }
    Ok(dir.join(format!("{app_id}.json")))
}


#[tauri::command]
pub(crate) async fn control_digital_download(app_id: u32, action: String) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        if action != "pause" && action != "resume" { return Err("Invalid download action".to_string()); }
        let path = write_digital_control(app_id, &action)?;
        for _ in 0..50 {
            std::thread::sleep(std::time::Duration::from_millis(100));
            if let Ok(raw) = fs::read_to_string(&path) {
                if let Ok(status) = serde_json::from_str::<serde_json::Value>(&raw) {
                    let phase = status["phase"].as_str().unwrap_or("");
                    if (action == "pause" && phase == "paused") || (action == "resume" && ["preparing", "downloading", "installing", "decompressing"].contains(&phase)) {
                        return Ok(status);
                    }
                    if ["completed", "cancelled", "error"].contains(&phase) {
                        return Err("La descarga ya terminó".to_string());
                    }
                }
            }
        }
        Err("El motor no confirmó la acción. El estado se actualizará al recibir su respuesta.".to_string())
    }).await.map_err(|err| err.to_string())?
}

#[tauri::command]
pub(crate) async fn cancel_digital_download(app_id: u32) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = write_digital_control(app_id, "cancel")?;
        for _ in 0..80 {
            std::thread::sleep(std::time::Duration::from_millis(100));
            if let Ok(raw) = fs::read_to_string(&path) {
                if let Ok(status) = serde_json::from_str::<serde_json::Value>(&raw) {
                    if status["phase"] == "cancelled" || status["phase"] == "completed" {
                        digital_pids().lock().map_err(|err| err.to_string())?.remove(&app_id);
                        return Ok(status);
                    }
                }
            }
        }
        let tracked = digital_pids().lock().map_err(|err| err.to_string())?.get(&app_id).copied();
        if tracked.is_none() {
            // No engine process is running for this download (the app was restarted, or the engine died).
            // There is nothing left to stop, so the download is simply cancelled instead of failing forever.
            let status = serde_json::json!({ "appId": app_id, "phase": "cancelled", "progressPercent": 0, "statusText": "Descarga cancelada" });
            fs::write(&path, status.to_string()).map_err(|err| err.to_string())?;
            return Ok(status);
        }
        let pid = digital_pids().lock().map_err(|err| err.to_string())?.get(&app_id).copied()
            .ok_or_else(|| "No se pudo confirmar la cancelación del proceso".to_string())?;
        #[cfg(target_os = "windows")]
        let result = Command::new("taskkill").args(["/F", "/T", "/PID", &pid.to_string()])
            .creation_flags(CREATE_NO_WINDOW).output().map_err(|err| err.to_string())?;
        #[cfg(not(target_os = "windows"))]
        let result = Command::new("kill").args(["-9", &pid.to_string()]).output().map_err(|err| err.to_string())?;
        if !result.status.success() { return Err("No se pudo detener el proceso de descarga".to_string()); }
        digital_pids().lock().map_err(|err| err.to_string())?.remove(&app_id);
        let status = serde_json::json!({ "appId": app_id, "phase": "cancelled", "progressPercent": 0, "statusText": "Descarga cancelada" });
        fs::write(&path, status.to_string()).map_err(|err| err.to_string())?;
        Ok(status)
    }).await.map_err(|err| err.to_string())?
}

/// Status reported when a download's status file cannot be read (empty, zero-filled or not JSON).
fn corrupt_status(app_id: u32) -> serde_json::Value {
    serde_json::json!({
        "appId": app_id.to_string(),
        "phase": "interrupted",
        "progressPercent": 0.0,
        "statusText": "El estado de la descarga se dañó",
        "error": "El archivo de estado quedó dañado, probablemente por un cierre inesperado. Reintentá la descarga."
    })
}

#[tauri::command]
pub(crate) async fn digital_download_status(app_id: u32) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let launcher = find_launcher_dir().ok_or_else(|| "Could not locate launcher directory".to_string())?;
        let status_file = launcher.join(".cache").join("digital_downloads").join(format!("{app_id}.json"));
        if status_file.exists() {
            let parsed = fs::read(&status_file)
                .map_err(|err| err.to_string())
                .and_then(|bytes| serde_json::from_slice::<serde_json::Value>(&bytes).map_err(|err| err.to_string()));
            let mut value = match parsed {
                Ok(value) if value.is_object() => value,
                // A crash can leave the status file empty or full of zeros. Report it as interrupted so the
                // caller stops polling it, instead of failing once a second for as long as the app is open.
                _ => return Ok(corrupt_status(app_id)),
            };
            let phase = value["phase"].as_str().unwrap_or("");
            if ["preparing", "downloading", "paused", "installing", "decompressing"].contains(&phase) {
                let stale = fs::metadata(&status_file).and_then(|m| m.modified()).ok()
                    .and_then(|time| time.elapsed().ok()).map(|elapsed| elapsed.as_secs() > 15).unwrap_or(false);
                if stale {
                    value["phase"] = serde_json::json!("interrupted");
                    value["statusText"] = serde_json::json!("El proceso dejó de responder");
                    value["error"] = serde_json::json!("El motor no actualizó su estado. Reintentá la descarga.");
                }
            }
            Ok(value)
        } else {
            println!("[Rust:digital_download_status] No status file yet for {app_id} (path={status_file:?})");
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
pub(crate) async fn query_digital_options(name: String) -> Result<serde_json::Value, String> {
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



#[cfg(test)]
mod digital_controls_tests {
    use super::*;
    use crate::access_policy;
    use std::path::PathBuf;
    use crate::launcher_runtime::launcher_below;
    struct Fixture {
        server: std::process::Child,
        launcher: PathBuf,
        previous_launcher: Option<std::ffi::OsString>,
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = self.server.kill();
            let _ = self.server.wait();
            match &self.previous_launcher {
                Some(path) => env::set_var("GAMEACCESS_LAUNCHER_DIR", path),
                None => env::remove_var("GAMEACCESS_LAUNCHER_DIR"),
            }
            if self.launcher.starts_with(env::temp_dir()) && self.launcher.file_name().unwrap().to_string_lossy().starts_with("gameaccess-digital-smoke-") {
                let _ = fs::remove_dir_all(&self.launcher);
            }
        }
    }
    fn wait_status(app_id: u32, predicate: impl Fn(&serde_json::Value) -> bool) -> serde_json::Value {
        for _ in 0..200 {
            let value = tauri::async_runtime::block_on(digital_download_status(app_id)).unwrap();
            if predicate(&value) { return value; }
            std::thread::sleep(std::time::Duration::from_millis(100));
        }
        panic!("Digital worker did not reach expected status");
    }
    #[test]
    fn installed_runtime_resolves_without_repository_or_python_on_path() {
        let root = env::temp_dir().join(format!("gameaccess-runtime-locator-{}", uuid::Uuid::new_v4()));
        let launcher = root.join("runtime/launcher");
        fs::create_dir_all(&launcher).unwrap();
        fs::create_dir_all(root.join("runtime/python")).unwrap();
        fs::write(launcher.join("digital_downloader.py"), "").unwrap();
        fs::write(root.join("runtime/python/python.exe"), "").unwrap();
        assert_eq!(launcher_below(&root), Some(launcher.clone()));
        assert_eq!(find_launcher_python(&launcher), root.join("runtime/python/python.exe"));
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn native_digital_pause_resume_cancel() {
        let original = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../launcher").canonicalize().unwrap();
        let python = find_launcher_python(&original);
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        drop(listener);
        let mut server_command = Command::new(&python);
        server_command.arg(original.join("tests/test_digital_download_controls.py")).args(["--serve", &port.to_string()])
            .stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null());
        #[cfg(target_os = "windows")]
        server_command.creation_flags(CREATE_NO_WINDOW);
        let server = server_command.spawn().unwrap();
        let launcher = env::temp_dir().join(format!("gameaccess-digital-smoke-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&launcher).unwrap();
        // Stage the same complete Python module set as the production launcher.
        for entry in fs::read_dir(&original).unwrap() {
            let path = entry.unwrap().path();
            if path.is_file() && path.extension().and_then(|v| v.to_str()) == Some("py") {
                fs::copy(&path, launcher.join(path.file_name().unwrap())).unwrap();
            }
        }
        let fixture = Fixture { server, launcher: launcher.clone(), previous_launcher: env::var_os("GAMEACCESS_LAUNCHER_DIR") };
        env::set_var("GAMEACCESS_LAUNCHER_DIR", &launcher);
        let url = format!("http://127.0.0.1:{port}/fixture.bin");
        let client = reqwest::blocking::Client::builder().timeout(std::time::Duration::from_secs(1)).build().unwrap();
        let mut ready = false;
        for _ in 0..50 {
            if client.head(&url).send().is_ok() { ready = true; break; }
            std::thread::sleep(std::time::Duration::from_millis(100));
        }
        assert!(ready, "Local fixture HTTP server did not start");
        let app_id = 987654321;
        access_policy::grant_fixture();
        tauri::async_runtime::block_on(start_digital_download(app_id, "HTTP smoke fixture".into(), url, None, "".into(), None, None, Some(true), None)).unwrap();
        wait_status(app_id, |s| s["phase"] == "downloading" && s["bytesDownloaded"].as_u64().unwrap_or(0) > 65536);
        let paused = tauri::async_runtime::block_on(control_digital_download(app_id, "pause".into())).unwrap();
        assert_eq!(paused["phase"], "paused");
        std::thread::sleep(std::time::Duration::from_millis(600));
        let settled = tauri::async_runtime::block_on(digital_download_status(app_id)).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(700));
        let still_paused = tauri::async_runtime::block_on(digital_download_status(app_id)).unwrap();
        assert_eq!(still_paused["phase"], "paused");
        assert_eq!(still_paused["bytesDownloaded"], settled["bytesDownloaded"]);
        tauri::async_runtime::block_on(control_digital_download(app_id, "resume".into())).unwrap();
        wait_status(app_id, |s| s["phase"] == "downloading");
        let cancelled = tauri::async_runtime::block_on(cancel_digital_download(app_id)).unwrap();
        assert_eq!(cancelled["phase"], "cancelled");
        assert!(!launcher.join("games/fixture.bin").exists());
        drop(fixture);
    }
}
