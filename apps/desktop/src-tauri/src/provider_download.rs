use serde::{Deserialize, Serialize};
use std::{
    env, fs,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct ProviderDownloadStatus {
    pub app_id: u32,
    pub state: String,
    pub progress: Option<f64>,
    pub bytes_downloaded: Option<u64>,
    pub bytes_total: Option<u64>,
    #[serde(default)]
    pub speed_bps: Option<u64>,
    #[serde(default)]
    pub eta_seconds: Option<u64>,
    pub installed: bool,
    #[serde(default)]
    pub provider_id: Option<String>,
    #[serde(default)]
    pub prepared_target: Option<String>,
    #[serde(default)]
    pub error: Option<String>,
    #[serde(default)]
    pub job_id: Option<String>,
    #[serde(default)]
    pub worker_pid: Option<u32>,
}

fn launcher_dir() -> Result<PathBuf, String> {
    if let Some(value) = env::var_os("GAMEACCESS_LAUNCHER_DIR") {
        let candidate = PathBuf::from(value);
        if candidate.is_dir() { return Ok(candidate); }
    }
    if let Ok(exe) = env::current_exe() {
        if let Some(dir) = exe.parent() {
            for candidate in [dir.join("launcher"), dir.join("runtime").join("launcher")] {
                if candidate.is_dir() { return Ok(candidate); }
            }
        }
    }
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(|desktop| desktop.parent())
        .map(|apps| apps.join("launcher"))
        .filter(|path| path.is_dir())
        .ok_or_else(|| "Could not locate the GameAccess provider download adapter".to_string())
}

fn python_executable(launcher: &Path) -> PathBuf {
    let venv = launcher.join(".venv").join("Scripts").join("python.exe");
    if venv.is_file() { venv } else { PathBuf::from("python") }
}
fn manager_script(launcher: &Path) -> PathBuf { launcher.join("provider_download_manager.py") }
fn status_path(launcher: &Path, app_id: u32) -> PathBuf {
    launcher.join(".gameaccess").join("downloads").join("status").join(format!("app-{app_id}.json"))
}
fn clear_provider_download_status(launcher: &Path, app_id: u32) -> Result<(), String> {
    match fs::remove_file(status_path(launcher, app_id)) {
        Ok(()) => Ok(()),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(err) => Err(format!("Could not clear stale provider download status: {err}")),
    }
}
fn hide_window(command: &mut Command) {
    #[cfg(target_os = "windows")]
    command.creation_flags(CREATE_NO_WINDOW);
}
fn parse_last_json_line(stdout: &[u8]) -> Result<serde_json::Value, String> {
    let text = String::from_utf8_lossy(stdout);
    let line = text.lines().rev().find(|line| !line.trim().is_empty()).ok_or_else(|| "Provider download adapter returned no JSON".to_string())?;
    serde_json::from_str(line).map_err(|err| format!("Provider download adapter returned invalid JSON: {err}"))
}

#[tauri::command]
pub fn provider_download_status(app_id: u32) -> Result<Option<ProviderDownloadStatus>, String> {
    let launcher = launcher_dir()?;
    let path = status_path(&launcher, app_id);
    if !path.is_file() { return Ok(None); }
    let body = fs::read_to_string(path).map_err(|err| format!("Could not read provider download status: {err}"))?;
    let status = serde_json::from_str::<ProviderDownloadStatus>(&body).map_err(|err| format!("Provider download status is invalid: {err}"))?;
    Ok(Some(status))
}

fn write_provider_download_status(launcher: &Path, status: &ProviderDownloadStatus) -> Result<(), String> {
    let path = status_path(launcher, status.app_id);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|err| format!("Could not create provider status cache: {err}"))?;
    }
    let body = serde_json::to_vec(status).map_err(|err| format!("Could not encode provider status cache: {err}"))?;
    let temp = path.with_extension("json.tmp");
    fs::write(&temp, body).map_err(|err| format!("Could not write provider status cache: {err}"))?;
    fs::rename(temp, path).map_err(|err| format!("Could not publish provider status cache: {err}"))
}

pub fn provider_installed_app_ids() -> Vec<u32> {
    let Ok(launcher) = launcher_dir() else { return Vec::new(); };
    let Some(root) = status_path(&launcher, 0).parent().map(Path::to_path_buf) else { return Vec::new(); };
    let Ok(entries) = fs::read_dir(root) else { return Vec::new(); };
    let mut ids = Vec::new();
    for entry in entries.flatten() {
        let Ok(body) = fs::read_to_string(entry.path()) else { continue; };
        let Ok(status) = serde_json::from_str::<ProviderDownloadStatus>(&body) else { continue; };
        let target_exists = status.prepared_target.as_ref().is_some_and(|value| Path::new(value).exists());
        if (status.installed || status.state == "installed") && target_exists { ids.push(status.app_id); }
    }
    ids.sort_unstable();
    ids.dedup();
    ids
}

fn validate_provider(app_id: u32) -> Result<String, String> {
    let launcher = launcher_dir()?;
    let python = python_executable(&launcher);
    let script = manager_script(&launcher);
    if !script.is_file() { return Err("GameAccess provider download manager is missing".into()); }
    let mut command = Command::new(python);
    command.current_dir(&launcher).env("PYTHONUTF8", "1").env("PYTHONIOENCODING", "utf-8").args([
        script.to_string_lossy().as_ref(), "--app-id", &app_id.to_string(), "--validate",
    ]);
    hide_window(&mut command);
    let output = command.output().map_err(|err| format!("Could not validate provider download ownership: {err}"))?;
    let payload = parse_last_json_line(&output.stdout)?;
    if !output.status.success() || !payload.get("ok").and_then(|value| value.as_bool()).unwrap_or(false) {
        return Err(payload.get("error").and_then(|value| value.as_str()).unwrap_or("GameAccess could not resolve a verified provider license").to_string());
    }
    payload.get("provider_id").and_then(|value| value.as_str()).filter(|value| !value.trim().is_empty()).map(str::to_string).ok_or_else(|| "Verified provider result did not include a provider id".to_string())
}

fn provider_download_estimate_blocking(app_id: u32) -> Result<ProviderDownloadStatus, String> {
    if app_id == 0 { return Err("Invalid Steam AppID".into()); }
    let provider_id = validate_provider(app_id)?;
    let launcher = launcher_dir()?;
    let python = python_executable(&launcher);
    let script = manager_script(&launcher);
    let mut command = Command::new(python);
    command.current_dir(&launcher).env("PYTHONUTF8", "1").env("PYTHONIOENCODING", "utf-8").args([
        script.to_string_lossy().as_ref(), "--app-id", &app_id.to_string(), "--estimate", "--provider-id", &provider_id,
    ]);
    hide_window(&mut command);
    let output = command.output().map_err(|err| format!("Could not estimate provider download size: {err}"))?;
    let payload = parse_last_json_line(&output.stdout)?;
    if !output.status.success() || !payload.get("ok").and_then(|value| value.as_bool()).unwrap_or(false) {
        return Err(payload.get("error").and_then(|value| value.as_str()).unwrap_or("Could not estimate provider download size").to_string());
    }
    Ok(ProviderDownloadStatus {
        app_id,
        state: "not-installed".into(),
        progress: None,
        bytes_downloaded: None,
        bytes_total: payload.get("bytes_total").and_then(|value| value.as_u64()),
        speed_bps: None,
        eta_seconds: None,
        installed: false,
        provider_id: Some(provider_id),
        prepared_target: None,
        error: None,
        job_id: None,
        worker_pid: None,
    })
}

#[tauri::command]
pub async fn provider_download_estimate(app_id: u32) -> Result<ProviderDownloadStatus, String> {
    tauri::async_runtime::spawn_blocking(move || provider_download_estimate_blocking(app_id)).await.map_err(|err| format!("Provider download estimate task failed: {err}"))?
}

fn new_job_id(app_id: u32) -> String {
    let micros = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_micros();
    format!("provider-{app_id}-{}-{micros}", std::process::id())
}
fn is_active_state(state: &str) -> bool {
    matches!(state, "requested" | "preparing" | "downloading" | "paused" | "cancelling")
}

fn start_provider_download_blocking(app_id: u32, requested_job_id: Option<String>) -> Result<ProviderDownloadStatus, String> {
    if app_id == 0 { return Err("Invalid Steam AppID".into()); }
    if let Some(status) = provider_download_status(app_id)? {
        if is_active_state(&status.state) { return Ok(status); }
        if status.installed || matches!(status.state.as_str(), "installed" | "prepared") { return Ok(status); }
    }

    let launcher = launcher_dir()?;
    clear_provider_download_status(&launcher, app_id)?;
    let python = python_executable(&launcher);
    let script = manager_script(&launcher);
    if !script.is_file() { return Err("GameAccess provider download manager is missing".into()); }
    let app_id_arg = app_id.to_string();
    let job_id = requested_job_id.filter(|value| !value.trim().is_empty()).unwrap_or_else(|| new_job_id(app_id));

    let initial = ProviderDownloadStatus {
        app_id,
        state: "preparing".into(),
        progress: Some(0.0),
        bytes_downloaded: Some(0),
        bytes_total: None,
        speed_bps: None,
        eta_seconds: None,
        installed: false,
        provider_id: None,
        prepared_target: None,
        error: None,
        job_id: Some(job_id.clone()),
        worker_pid: None,
    };
    write_provider_download_status(&launcher, &initial)?;

    let mut command = Command::new(python);
    command.current_dir(&launcher).env("PYTHONUTF8", "1").env("PYTHONIOENCODING", "utf-8").args([
        script.to_string_lossy().as_ref(), "--app-id", &app_id_arg, "--run", "--job-id", &job_id,
    ]).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
    hide_window(&mut command);
    let child = command.spawn().map_err(|err| format!("Could not start provider download: {err}"))?;
    let mut started = initial;
    started.worker_pid = Some(child.id());
    let current = provider_download_status(app_id)?;
    if current.as_ref().is_some_and(|value| value.job_id.as_deref() == Some(job_id.as_str()) && !is_active_state(&value.state)) {
        return Ok(current.expect("checked Some"));
    }
    write_provider_download_status(&launcher, &started)?;
    Ok(started)
}

#[tauri::command]
pub async fn start_provider_download(app_id: u32, job_id: Option<String>) -> Result<ProviderDownloadStatus, String> {
    tauri::async_runtime::spawn_blocking(move || start_provider_download_blocking(app_id, job_id)).await.map_err(|err| format!("Provider download start task failed: {err}"))?
}

#[cfg(target_os = "windows")]
fn verify_worker_process(pid: u32, app_id: u32, job_id: &str, manager: &Path) -> Result<bool, String> {
    let manager_name = manager.file_name().and_then(|value| value.to_str()).unwrap_or("provider_download_manager.py");
    let script = format!("$p=Get-CimInstance Win32_Process -Filter \"ProcessId = {pid}\"; if($null -eq $p){{exit 3}}; [pscustomobject]@{{ProcessId=$p.ProcessId;CommandLine=$p.CommandLine}} | ConvertTo-Json -Compress");
    let mut command = Command::new("powershell.exe");
    command.args(["-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", &script]);
    hide_window(&mut command);
    let output = command.output().map_err(|err| format!("Could not verify provider worker identity: {err}"))?;
    if output.status.code() == Some(3) { return Ok(false); }
    if !output.status.success() { return Err("Could not verify provider worker identity".into()); }
    let value: serde_json::Value = serde_json::from_slice(&output.stdout).map_err(|err| format!("Worker identity probe returned invalid JSON: {err}"))?;
    let line = value.get("CommandLine").and_then(|value| value.as_str()).unwrap_or("");
    Ok(line.contains(manager_name) && line.contains("--app-id") && line.contains(&app_id.to_string()) && line.contains(job_id))
}

#[cfg(target_os = "windows")]
fn terminate_verified_worker_tree(pid: u32) -> Result<(), String> {
    let mut command = Command::new("taskkill.exe");
    command.args(["/PID", &pid.to_string(), "/T", "/F"]);
    hide_window(&mut command);
    let output = command.output().map_err(|err| format!("Could not terminate provider worker: {err}"))?;
    if output.status.success() { Ok(()) } else { Err(String::from_utf8_lossy(&output.stderr).trim().to_string()) }
}

fn cancel_provider_download_blocking(app_id: u32, job_id: String) -> Result<ProviderDownloadStatus, String> {
    let launcher = launcher_dir()?;
    let mut status = provider_download_status(app_id)?.ok_or_else(|| "No managed provider download exists for this AppID".to_string())?;
    if status.job_id.as_deref() != Some(job_id.as_str()) { return Err("Download job identity no longer matches the active work".into()); }
    if status.installed || matches!(status.state.as_str(), "installed" | "prepared" | "cancelled") { return Ok(status); }
    if !is_active_state(&status.state) { return Err(format!("Download cannot be cancelled from state {}", status.state)); }

    status.state = "cancelling".into();
    status.error = None;
    write_provider_download_status(&launcher, &status)?;

    for _ in 0..8 {
        thread::sleep(Duration::from_millis(100));
        if let Some(current) = provider_download_status(app_id)? {
            if current.job_id.as_deref() == Some(job_id.as_str()) && matches!(current.state.as_str(), "cancelled" | "installed") { return Ok(current); }
        }
    }

    if let Some(pid) = status.worker_pid {
        #[cfg(target_os = "windows")]
        {
            let manager = manager_script(&launcher);
            if verify_worker_process(pid, app_id, &job_id, &manager)? { terminate_verified_worker_tree(pid)?; }
        }
        #[cfg(not(target_os = "windows"))]
        return Err("Managed provider cancellation is currently verified only on Windows".into());
    }

    if let Some(current) = provider_download_status(app_id)? {
        if current.job_id.as_deref() == Some(job_id.as_str()) && (current.installed || current.state == "installed") { return Ok(current); }
    }
    status.state = "cancelled".into();
    status.installed = false;
    status.speed_bps = None;
    status.eta_seconds = None;
    status.error = None;
    status.worker_pid = None;
    write_provider_download_status(&launcher, &status)?;
    Ok(status)
}

#[tauri::command]
pub async fn cancel_provider_download(app_id: u32, job_id: String) -> Result<ProviderDownloadStatus, String> {
    tauri::async_runtime::spawn_blocking(move || cancel_provider_download_blocking(app_id, job_id)).await.map_err(|err| format!("Provider cancellation task failed: {err}"))?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_provider_download_status_shape_with_optional_job_identity() {
        let status: ProviderDownloadStatus = serde_json::from_str(
            r#"{"app_id":1091500,"state":"preparing","progress":null,"bytes_downloaded":null,"bytes_total":null,"installed":false,"provider_id":"provider-001","job_id":"job-1","worker_pid":42}"#,
        ).expect("status should deserialize");
        assert_eq!(status.app_id, 1_091_500);
        assert_eq!(status.provider_id.as_deref(), Some("provider-001"));
        assert_eq!(status.job_id.as_deref(), Some("job-1"));
        assert_eq!(status.worker_pid, Some(42));
        assert!(is_active_state("cancelling"));
        assert!(!is_active_state("cancelled"));
    }

    #[test]
    fn supplied_job_identity_is_stable() {
        let requested = Some("ui-42-fixed".to_string());
        let chosen = requested.clone().filter(|value| !value.trim().is_empty()).unwrap_or_else(|| new_job_id(42));
        assert_eq!(chosen, "ui-42-fixed");
    }

    #[test]
    fn old_status_json_remains_compatible() {
        let status: ProviderDownloadStatus = serde_json::from_str(
            r#"{"app_id":7,"state":"installed","progress":100,"bytes_downloaded":1,"bytes_total":1,"installed":true}"#,
        ).expect("legacy status should deserialize");
        assert_eq!(status.job_id, None);
        assert_eq!(status.worker_pid, None);
    }
}
