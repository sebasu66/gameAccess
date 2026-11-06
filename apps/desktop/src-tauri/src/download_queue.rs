//! Starts the launcher's Download Manager (`game_download_manager.queue_service`) for this app session and tells the
//! interface how to reach it. The Download Manager owns the download queue; Rust only starts and stops it.
use std::io::{BufRead, BufReader};
use std::process::{Child, Command, Stdio};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

use crate::activity_log::append_narration_lines;
use crate::launcher_runtime::{find_launcher_dir, find_launcher_python};

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

struct QueueProcess {
    child: Child,
    port: u16,
    token: String,
}

static QUEUE: OnceLock<Mutex<Option<QueueProcess>>> = OnceLock::new();

fn slot() -> &'static Mutex<Option<QueueProcess>> {
    QUEUE.get_or_init(|| Mutex::new(None))
}

fn log(message: String, level: &str) {
    let _ = append_narration_lines(vec![message], "DOWNLOAD_MANAGER".into(), level.into());
}

fn spawn() -> Result<QueueProcess, String> {
    let launcher = find_launcher_dir().ok_or("Could not locate launcher directory")?;
    let python = find_launcher_python(&launcher);
    let token = format!("{}{}", uuid::Uuid::new_v4().simple(), uuid::Uuid::new_v4().simple());
    let mut cmd = Command::new(&python);
    cmd.current_dir(&launcher)
        .env("PYTHONUTF8", "1")
        .env("PYTHONIOENCODING", "utf-8")
        .args(["-m", "game_download_manager.queue_service", "--token", &token])
        // stdin stays open while the app lives: if the app dies, the Download Manager sees it close and stops.
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    #[cfg(target_os = "windows")]
    cmd.creation_flags(CREATE_NO_WINDOW);
    let mut child = cmd.spawn().map_err(|err| format!("Could not start the Download Manager: {err}"))?;
    let stdout = child.stdout.take().ok_or("The Download Manager has no output")?;
    let (sender, receiver) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let mut reader = BufReader::new(stdout);
        let mut line = String::new();
        let _ = sender.send(reader.read_line(&mut line).map(|_| line));
        // Keep draining so the process never blocks on a full pipe.
        let mut rest = String::new();
        while reader.read_line(&mut rest).map(|n| n > 0).unwrap_or(false) { rest.clear(); }
    });
    let line = receiver
        .recv_timeout(Duration::from_secs(20))
        .map_err(|_| "The Download Manager did not start in time".to_string())?
        .map_err(|err| format!("The Download Manager did not report its port: {err}"))?;
    let port = serde_json::from_str::<serde_json::Value>(line.trim())
        .ok()
        .and_then(|value| value["port"].as_u64())
        .and_then(|port| u16::try_from(port).ok())
        .ok_or_else(|| {
            let _ = child.kill();
            format!("The Download Manager reported an invalid port: {}", line.trim())
        })?;
    log(format!("Download Manager started on 127.0.0.1:{port} (pid {}).", child.id()), "INFO");
    Ok(QueueProcess { child, port, token })
}

fn running_process(guard: &mut Option<QueueProcess>) -> Result<(u16, String), String> {
    let running = match guard.as_mut() {
        Some(process) => process.child.try_wait().map(|status| status.is_none()).unwrap_or(false),
        None => false,
    };
    if !running {
        if guard.is_some() {
            log("The Download Manager had stopped; starting it again.".into(), "WARN");
        }
        *guard = Some(spawn()?);
    }
    let process = guard.as_ref().ok_or("Download Manager unavailable")?;
    Ok((process.port, process.token.clone()))
}

fn send(port: u16, token: &str, path: &str, body: &Option<serde_json::Value>) -> Result<reqwest::blocking::Response, reqwest::Error> {
    let client = reqwest::blocking::Client::builder().no_proxy().timeout(Duration::from_secs(20)).build()?;
    let url = format!("http://127.0.0.1:{port}{path}");
    match body {
        Some(body) => client.post(url).header("X-GameAccess-Token", token).json(body).send(),
        None => client.get(url).header("X-GameAccess-Token", token).send(),
    }
}

/// An order for the Download Manager (or a state read when `body` is null), relayed for the interface: the
/// interface never talks to the local port itself, so there is no cross-origin request and the token stays here.
#[tauri::command]
pub(crate) async fn download_queue_request(path: String, body: Option<serde_json::Value>) -> Result<serde_json::Value, String> {
    let valid = path == "/state" || path == "/config" || path == "/jobs" || path == "/suspend"
        || (path.starts_with("/jobs/") && path[6..].chars().all(|c| c.is_ascii_alphanumeric() || c == '/'));
    if !valid {
        return Err("Invalid Download Manager request".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        for attempt in 0..2 {
            let (port, token) = {
                let mut guard = slot().lock().map_err(|_| "Download Manager lock poisoned".to_string())?;
                if attempt > 0 {
                    // The process did not answer: start a new one (it restores the queue from disk).
                    if let Some(mut stale) = guard.take() { let _ = stale.child.kill(); }
                }
                running_process(&mut guard)?
            };
            match send(port, &token, &path, &body) {
                Ok(response) => {
                    let status = response.status().as_u16();
                    let data = response.json::<serde_json::Value>().unwrap_or(serde_json::Value::Null);
                    return Ok(serde_json::json!({ "status": status, "data": data }));
                }
                Err(err) if attempt == 0 && (err.is_connect() || err.is_timeout()) => continue,
                Err(err) => return Err(format!("Download Manager unavailable: {err}")),
            }
        }
        Err("Download Manager unavailable".into())
    })
    .await
    .map_err(|err| err.to_string())?
}

/// The activation ended: the Download Manager pauses every pending download and starts nothing more.
pub(crate) fn suspend() {
    let target = slot().lock().ok().and_then(|guard| guard.as_ref().map(|process| (process.port, process.token.clone())));
    let Some((port, token)) = target else { return };
    if let Ok(client) = reqwest::blocking::Client::builder().no_proxy().timeout(Duration::from_secs(10)).build() {
        let _ = client.post(format!("http://127.0.0.1:{port}/suspend")).header("X-GameAccess-Token", token).send();
    }
}

/// The app is closing: the Download Manager stops its workers (nothing is deleted) and remembers what to resume.
pub(crate) fn shutdown() {
    let Ok(mut guard) = slot().lock() else { return };
    let Some(mut process) = guard.take() else { return };
    let client = reqwest::blocking::Client::builder().no_proxy().timeout(Duration::from_secs(15)).build();
    if let Ok(client) = client {
        let _ = client
            .post(format!("http://127.0.0.1:{}/shutdown", process.port))
            .header("X-GameAccess-Token", &process.token)
            .send();
    }
    for _ in 0..100 {
        if process.child.try_wait().map(|status| status.is_some()).unwrap_or(true) {
            return;
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    let _ = process.child.kill();
}
