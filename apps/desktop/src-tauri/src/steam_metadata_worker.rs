//! One serial, local Steam metadata worker for the loaded catalog. Cache persists
//! across restarts. Game detection fails closed; network failures back off.
use crate::native_core;
use serde_json::{json, Value};
use std::{path::PathBuf, sync::{Mutex, OnceLock, atomic::{AtomicBool, Ordering}}, time::Duration};

#[derive(Default)]
struct Worker { ids: Vec<u32>, roots: Vec<PathBuf>, cursor: usize, completed: usize, phase: String, changed: Vec<u32>, error: Option<String> }
static STATE: OnceLock<Mutex<Worker>> = OnceLock::new();
static STARTED: AtomicBool = AtomicBool::new(false);
fn state() -> &'static Mutex<Worker> { STATE.get_or_init(|| Mutex::new(Worker::default())) }

pub fn start(mut ids: Vec<u32>, mut roots: Vec<PathBuf>) {
    ids.retain(|id| *id > 0); ids.sort_unstable(); ids.dedup(); ids.truncate(10000);
    roots.extend(native_core::steam_library_roots().into_iter().map(|root| root.join("steamapps/common")));
    {
        let mut worker = state().lock().unwrap();
        if worker.ids != ids { worker.ids = ids; worker.cursor = 0; worker.completed = 0; }
        worker.roots = roots;
    }
    if STARTED.swap(true, Ordering::SeqCst) { return; }
    std::thread::spawn(|| loop {
        let next = {
            let mut worker = state().lock().unwrap();
            if worker.ids.is_empty() || worker.cursor >= worker.ids.len() {
                worker.phase = "idle".into(); worker.cursor = 0; None
            } else { Some((worker.ids[worker.cursor], worker.roots.clone())) }
        };
        let Some((app_id, roots)) = next else { std::thread::sleep(Duration::from_secs(60)); continue; };
        if native_core::steam_metadata_cache_fresh(app_id) {
            let mut worker = state().lock().unwrap(); worker.cursor += 1; worker.completed = worker.cursor;
            drop(worker); std::thread::sleep(Duration::from_millis(100)); continue;
        }
        match game_running(&roots) {
            Ok(false) => {},
            result => {
                let mut worker = state().lock().unwrap(); worker.phase = "paused".into();
                worker.error = result.err(); drop(worker);
                std::thread::sleep(Duration::from_secs(15)); continue;
            }
        }
        { let mut worker = state().lock().unwrap(); worker.phase = "updating".into(); worker.error = None; }
        let result = native_core::steam_store_metadata_refresh(app_id, true);
        let failed = result.as_ref().map(|data| data.get("gameaccess_refresh_warning").is_some()).unwrap_or(true);
        {
            let mut worker = state().lock().unwrap();
            worker.cursor += 1; worker.completed = worker.cursor;
            if result.is_ok() && !worker.changed.contains(&app_id) { worker.changed.push(app_id); }
            if failed { worker.phase = "backoff".into(); worker.error = Some("Steam no respondió o limitó las consultas; se reintentará más tarde.".into()); }
        }
        // No bulk parallel requests: two Steam requests per game, five seconds
        // between games. Finish an in-flight request, then check games again.
        std::thread::sleep(Duration::from_secs(if failed { 300 } else { 5 }));
    });
}

pub fn poll() -> Value {
    let (changed, status) = {
        let mut worker = state().lock().unwrap();
        let changed = std::mem::take(&mut worker.changed);
        (changed, json!({ "phase": worker.phase, "completed": worker.completed, "total": worker.ids.len(), "error": worker.error }))
    };
    json!({ "status": status, "metadata": native_core::steam_metadata_catalog_cache(&changed) })
}

pub fn path_is_game(path: &str, roots: &[PathBuf]) -> bool {
    let path = path.replace('/', "\\").to_lowercase();
    path.contains("\\steamapps\\common\\") || roots.iter().any(|root| {
        let prefix = format!("{}\\", root.to_string_lossy().replace('/', "\\").trim_end_matches('\\').to_lowercase());
        path.starts_with(&prefix)
    })
}

pub fn game_running(roots: &[PathBuf]) -> Result<bool, String> {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        // Detect Steam games regardless of which launcher started them, plus
        // executable processes in known Steam/Digital installation directories.
        let output = std::process::Command::new("powershell.exe").args(["-NoProfile", "-Command",
            "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; $ErrorActionPreference='Stop'; $steam=@(Get-ChildItem 'HKCU:\\Software\\Valve\\Steam\\Apps' -ErrorAction SilentlyContinue | Get-ItemProperty -ErrorAction SilentlyContinue | Where-Object {$_.Running -eq 1}).Count -gt 0; $paths=@(Get-CimInstance Win32_Process | Where-Object {$_.ExecutablePath} | Select-Object -ExpandProperty ExecutablePath); @{steam=$steam;paths=$paths} | ConvertTo-Json -Compress"])
            .creation_flags(0x08000000).output().map_err(|err| err.to_string())?;
        if !output.status.success() { return Err("No se pudo verificar si hay juegos ejecutándose.".into()); }
        let value: Value = serde_json::from_slice(&output.stdout).map_err(|err| err.to_string())?;
        let paths = value["paths"].as_array().ok_or("No se pudo leer la lista de procesos")?;
        Ok(value["steam"].as_bool() == Some(true) || paths.iter().filter_map(Value::as_str).any(|path| path_is_game(path, roots)))
    }
    #[cfg(not(target_os = "windows"))]
    { let _ = roots; Err("Detección de juegos disponible solamente en Windows".into()) }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn detects_game_installations_without_matching_sibling_folders() {
        let roots = vec![PathBuf::from("C:\\Games")];
        assert!(path_is_game("c:/games/Example/game.exe", &roots));
        assert!(path_is_game("D:\\SteamLibrary\\steamapps\\common\\Example\\game.exe", &[]));
        assert!(!path_is_game("C:\\GamesBackup\\tool.exe", &roots));
        assert!(!path_is_game("C:\\Windows\\explorer.exe", &roots));
    }
    #[test]
    #[ignore = "reads live Windows game activity"]
    fn live_game_detection_returns_a_valid_result() { game_running(&[]).expect("game activity probe"); }
    #[test]
    #[ignore = "requires Steam network access and no game running"]
    fn live_worker_updates_a_game_when_idle() {
        if game_running(&[]).unwrap() { println!("Skipped: a Steam game is running"); return; }
        let app_id = [620, 413150, 730].into_iter().find(|id| !native_core::steam_metadata_cache_fresh(*id)).unwrap_or(620);
        start(vec![app_id], vec![]);
        let deadline = std::time::Instant::now() + Duration::from_secs(45);
        loop {
            let snapshot = poll();
            if snapshot["status"]["completed"] == 1 {
                let cached = native_core::steam_metadata_catalog_cache(&[app_id]);
                assert!(cached[app_id.to_string()]["categories"].is_array(), "Steam catalog projection missing categories");
                println!("Background worker completed AppID {app_id}: {}", snapshot["status"]);
                break;
            }
            assert!(std::time::Instant::now() < deadline, "background worker did not finish one game");
            std::thread::sleep(Duration::from_millis(100));
        }
    }
    #[test]
    #[ignore = "reads live Windows processes"]
    fn live_worker_pauses_for_a_process_in_a_game_directory() {
        // Treat this test executable's directory as a known game installation.
        // The detected process is real; no game is launched and no Steam request
        // is made because the activity gate must keep this missing-cache ID paused.
        let root = std::env::current_exe().unwrap().parent().unwrap().to_path_buf();
        assert!(game_running(&[root.clone()]).unwrap());
        start(vec![u32::MAX], vec![root]);
        let deadline = std::time::Instant::now() + Duration::from_secs(20);
        loop {
            let snapshot = poll();
            if snapshot["status"]["phase"] == "paused" {
                assert_eq!(snapshot["status"]["completed"], 0);
                assert_eq!(snapshot["metadata"], json!({}));
                break;
            }
            assert!(std::time::Instant::now() < deadline, "worker did not pause");
            std::thread::sleep(Duration::from_millis(100));
        }
    }
}
