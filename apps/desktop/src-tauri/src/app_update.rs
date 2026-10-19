//! Release builds keep themselves current. The interface shows the mandatory update dialog; this module is the
//! safety net for a build whose interface never starts (a broken release must still be able to replace itself),
//! and the self-test the release workflow runs on the installed app before publishing it.
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use tauri::AppHandle;
use tauri_plugin_updater::UpdaterExt;

use crate::{activity_log, catalog_cache, launcher_runtime};

static FRONTEND_ALIVE: AtomicBool = AtomicBool::new(false);
const WATCHDOG_SECONDS: u64 = 60;

/// Only builds released from main update themselves (the release workflow sets GAMEACCESS_CHANNEL=release).
pub(crate) fn is_release_build() -> bool {
    option_env!("GAMEACCESS_CHANNEL") == Some("release")
}

fn log(message: &str, level: &str) {
    let _ = activity_log::append_narration_log(message.to_string(), "UPDATE".to_string(), level.to_string());
}

#[tauri::command]
pub(crate) fn app_frontend_alive() {
    FRONTEND_ALIVE.store(true, Ordering::SeqCst);
}

/// If the interface has not reported in after a minute, look for an update here and install it.
pub(crate) fn start_watchdog(app: AppHandle) {
    if !is_release_build() {
        return;
    }
    tauri::async_runtime::spawn(async move {
        tokio_sleep(Duration::from_secs(WATCHDOG_SECONDS)).await;
        if FRONTEND_ALIVE.load(Ordering::SeqCst) {
            return;
        }
        log("The interface did not start within a minute; checking for an update natively.", "WARN");
        let update = match app.updater() {
            Ok(updater) => updater.check().await,
            Err(err) => { log(&format!("Native updater unavailable: {err}"), "ERROR"); return; }
        };
        match update {
            Ok(Some(update)) => {
                log(&format!("Installing update {} natively.", update.version), "WARN");
                match update.download_and_install(|_, _| {}, || {}).await {
                    Ok(()) => app.restart(),
                    Err(err) => log(&format!("Native update failed: {err}"), "ERROR"),
                }
            }
            Ok(None) => log("No update available for the stuck interface.", "WARN"),
            Err(err) => log(&format!("Native update check failed: {err}"), "ERROR"),
        }
    });
}

async fn tokio_sleep(duration: Duration) {
    let _ = tauri::async_runtime::spawn_blocking(move || std::thread::sleep(duration)).await;
}

/// `gameaccess-desktop.exe --self-test`: checks the installed runtime (launcher, embedded Python, catalog seed)
/// without opening a window, prints the result and exits 0 when everything is in place.
pub(crate) fn run_self_test_if_requested() {
    if !std::env::args().any(|arg| arg == "--self-test") {
        return;
    }
    let mut failures = Vec::new();
    let launcher = launcher_runtime::find_launcher_dir();
    match &launcher {
        Some(dir) => {
            let python = launcher_runtime::find_launcher_python(dir);
            if !python.is_file() {
                failures.push(format!("python missing: {}", python.display()));
            } else {
                // The Download Manager (the download queue) must import with the packaged Python.
                let mut check = std::process::Command::new(&python);
                check.current_dir(dir).args(["-c", "import game_download_manager.queue_service"]);
                #[cfg(target_os = "windows")]
                {
                    use std::os::windows::process::CommandExt;
                    check.creation_flags(0x0800_0000);
                }
                match check.status() {
                    Ok(status) if status.success() => {}
                    Ok(status) => failures.push(format!("Download Manager does not import (exit {status})")),
                    Err(err) => failures.push(format!("Download Manager check failed: {err}")),
                }
            }
        }
        None => failures.push("launcher directory not found".to_string()),
    }
    if let Err(err) = catalog_cache::self_test_catalog() {
        failures.push(format!("catalog: {err}"));
    }
    let ok = failures.is_empty();
    let report = serde_json::json!({
        "ok": ok,
        "version": env!("CARGO_PKG_VERSION"),
        "channel": option_env!("GAMEACCESS_CHANNEL").unwrap_or("dev"),
        "launcher": launcher.map(|dir| dir.display().to_string()),
        "failures": failures,
    });
    println!("{report}");
    // A release build has no console; the workflow reads the result from this file.
    if let Ok(path) = std::env::var("GAMEACCESS_SELF_TEST_OUT") {
        let _ = std::fs::write(path, report.to_string());
    }
    std::process::exit(if ok { 0 } else { 1 });
}
