use serde::{Deserialize, Serialize};
use std::{
    env, fs,
    io::Write,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{Mutex, OnceLock},
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

static START_MUTEX: OnceLock<Mutex<()>> = OnceLock::new();

fn start_mutex() -> &'static Mutex<()> {
    START_MUTEX.get_or_init(|| Mutex::new(()))
}

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
    pub library_index: Option<u32>,
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
        if candidate.is_dir() {
            return Ok(candidate);
        }
    }
    if let Ok(exe) = env::current_exe() {
        if let Some(dir) = exe.parent() {
            for candidate in [dir.join("launcher"), dir.join("runtime").join("launcher")] {
                if candidate.is_dir() {
                    return Ok(candidate);
                }
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
    if let Some(runtime_root) = launcher.parent() {
        let embedded = runtime_root.join("python").join("python.exe");
        if embedded.is_file() {
            return embedded;
        }
    }
    let venv = launcher.join(".venv").join("Scripts").join("python.exe");
    if venv.is_file() {
        venv
    } else {
        PathBuf::from("python")
    }
}
fn manager_script(launcher: &Path) -> PathBuf {
    launcher.join("provider_download_manager.py")
}
fn reconciliation_script(launcher: &Path) -> PathBuf {
    launcher.join("download_reconciliation.py")
}
fn data_root(launcher: &Path) -> PathBuf {
    if let Some(value) = env::var_os("GAMEACCESS_DATA_DIR") {
        let candidate = PathBuf::from(value);
        if !candidate.as_os_str().is_empty() {
            return candidate;
        }
    }
    if let Some(local) = env::var_os("LOCALAPPDATA") {
        return PathBuf::from(local).join("GameAccess");
    }
    launcher.join(".gameaccess")
}

fn status_path(launcher: &Path, app_id: u32) -> PathBuf {
    data_root(launcher)
        .join("downloads")
        .join("status")
        .join(format!("app-{app_id}.json"))
}

fn apply_runtime_env(command: &mut Command, launcher: &Path) {
    command
        .env("PYTHONUTF8", "1")
        .env("PYTHONIOENCODING", "utf-8")
        .env("GAMEACCESS_DATA_DIR", data_root(launcher));
}
fn clear_provider_download_status(launcher: &Path, app_id: u32) -> Result<(), String> {
    match fs::remove_file(status_path(launcher, app_id)) {
        Ok(()) => Ok(()),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(err) => Err(format!(
            "Could not clear stale provider download status: {err}"
        )),
    }
}
fn hide_window(command: &mut Command) {
    #[cfg(target_os = "windows")]
    command.creation_flags(CREATE_NO_WINDOW);
}
fn parse_last_json_line(stdout: &[u8]) -> Result<serde_json::Value, String> {
    let text = String::from_utf8_lossy(stdout);
    let line = text
        .lines()
        .rev()
        .find(|line| !line.trim().is_empty())
        .ok_or_else(|| "Provider download adapter returned no JSON".to_string())?;
    serde_json::from_str(line)
        .map_err(|err| format!("Provider download adapter returned invalid JSON: {err}"))
}

#[tauri::command]
pub fn provider_download_status(app_id: u32) -> Result<Option<ProviderDownloadStatus>, String> {
    let launcher = launcher_dir()?;
    let path = status_path(&launcher, app_id);
    if !path.is_file() {
        return Ok(None);
    }
    let body = fs::read_to_string(path)
        .map_err(|err| format!("Could not read provider download status: {err}"))?;
    let status = serde_json::from_str::<ProviderDownloadStatus>(&body)
        .map_err(|err| format!("Provider download status is invalid: {err}"))?;
    Ok(Some(validate_ready_status(status)))
}

#[tauri::command]
pub fn provider_download_statuses() -> Result<Vec<ProviderDownloadStatus>, String> {
    let launcher = launcher_dir()?;
    let Some(root) = status_path(&launcher, 0).parent().map(Path::to_path_buf) else {
        return Ok(Vec::new());
    };
    let Ok(entries) = fs::read_dir(root) else {
        return Ok(Vec::new());
    };
    let mut statuses = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() { continue; }
        let Ok(body) = fs::read_to_string(path) else { continue; };
        let Ok(status) = serde_json::from_str::<ProviderDownloadStatus>(&body) else { continue; };
        statuses.push(validate_ready_status(status));
    }
    statuses.sort_by_key(|status| status.app_id);
    Ok(statuses)
}

fn reconciliation_command(launcher: &Path, args: &[String]) -> Result<serde_json::Value, String> {
    let python = python_executable(launcher);
    let script = reconciliation_script(launcher);
    if !script.is_file() {
        return Err("GameAccess download reconciliation script is missing".into());
    }
    let mut command = Command::new(python);
    apply_runtime_env(&mut command, launcher);
    command
        .current_dir(launcher)
        .arg(script)
        .args(args);
    hide_window(&mut command);
    let output = command
        .output()
        .map_err(|err| format!("Could not run download reconciliation: {err}"))?;
    let payload = parse_last_json_line(&output.stdout)?;
    if !output.status.success() {
        return Err(payload
            .get("error")
            .and_then(|value| value.as_str())
            .unwrap_or("Download reconciliation failed")
            .to_string());
    }
    Ok(payload)
}

fn reconcile_download_staging_blocking() -> Result<Vec<ProviderDownloadStatus>, String> {
    let _guard = start_mutex()
        .lock()
        .map_err(|_| "Provider download start lock is poisoned".to_string())?;
    let launcher = launcher_dir()?;

    for mut status in provider_download_statuses()? {
        if !is_active_state(&status.state) {
            continue;
        }
        #[cfg(target_os = "windows")]
        let worker_valid = match (status.worker_pid, status.job_id.as_deref()) {
            (Some(pid), Some(job_id)) => {
                verify_worker_process(pid, status.app_id, job_id, &manager_script(&launcher))?
            }
            _ => false,
        };
        #[cfg(not(target_os = "windows"))]
        let worker_valid = status.worker_pid.is_some() && status.job_id.is_some();
        if worker_valid {
            continue;
        }
        status.state = "interrupted".into();
        status.progress = status.progress.filter(|value| value.is_finite());
        status.speed_bps = None;
        status.eta_seconds = None;
        status.worker_pid = None;
        status.error = None;
        write_provider_download_status(&launcher, &status)?;
    }

    let payload = reconciliation_command(&launcher, &["--reconcile".into()])?;
    let mut interrupted: Vec<ProviderDownloadStatus> = serde_json::from_value(payload)
        .map_err(|err| format!("Download reconciliation returned invalid status data: {err}"))?;
    for status in &interrupted {
        write_provider_download_status(&launcher, status)?;
    }
    interrupted.sort_by_key(|status| status.app_id);
    Ok(interrupted)
}

#[tauri::command]
pub async fn reconcile_download_staging() -> Result<Vec<ProviderDownloadStatus>, String> {
    tauri::async_runtime::spawn_blocking(reconcile_download_staging_blocking)
        .await
        .map_err(|err| format!("Download staging reconciliation task failed: {err}"))?
}

fn discard_interrupted_download_blocking(
    app_id: u32,
    provider_id: String,
    job_id: String,
) -> Result<(), String> {
    let _guard = start_mutex()
        .lock()
        .map_err(|_| "Provider download start lock is poisoned".to_string())?;
    let launcher = launcher_dir()?;
    let status = provider_download_status(app_id)?
        .ok_or_else(|| "The interrupted download status no longer exists".to_string())?;
    if status.state != "interrupted"
        || status.provider_id.as_deref() != Some(provider_id.as_str())
        || status.job_id.as_deref() != Some(job_id.as_str())
    {
        return Err("The download changed; its staging files were preserved".into());
    }
    let args = vec![
        "--discard".into(),
        "--app-id".into(),
        app_id.to_string(),
        "--provider-id".into(),
        provider_id,
        "--job-id".into(),
        job_id,
    ];
    reconciliation_command(&launcher, &args)?;
    Ok(())
}

#[tauri::command]
pub async fn discard_interrupted_download(
    app_id: u32,
    provider_id: String,
    job_id: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        discard_interrupted_download_blocking(app_id, provider_id, job_id)
    })
    .await
    .map_err(|err| format!("Interrupted-download discard task failed: {err}"))?
}

fn write_provider_download_status(
    launcher: &Path,
    status: &ProviderDownloadStatus,
) -> Result<(), String> {
    let path = status_path(launcher, status.app_id);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|err| format!("Could not create provider status cache: {err}"))?;
    }
    let body = serde_json::to_vec(status)
        .map_err(|err| format!("Could not encode provider status cache: {err}"))?;
    let temp = path.with_extension("json.tmp");
    fs::write(&temp, body)
        .map_err(|err| format!("Could not write provider status cache: {err}"))?;
    fs::rename(temp, path).map_err(|err| format!("Could not publish provider status cache: {err}"))
}

// Download-tool bookkeeping can remain after Steam removes the game itself.
fn has_game_payload(root: &Path) -> bool {
    let mut pending = vec![root.to_path_buf()];
    while let Some(directory) = pending.pop() {
        let Ok(entries) = fs::read_dir(directory) else { continue; };
        for entry in entries.flatten() {
            if entry.file_name().to_string_lossy().starts_with('.') { continue; }
            let Ok(kind) = entry.file_type() else { continue; };
            if kind.is_symlink() { continue; }
            if kind.is_dir() { pending.push(entry.path()); }
            else if kind.is_file() && entry.metadata().is_ok_and(|metadata| metadata.len() > 0) { return true; }
        }
    }
    false
}

fn validate_ready_status(mut status: ProviderDownloadStatus) -> ProviderDownloadStatus {
    if status.state == "prepared" && !status.prepared_target.as_ref().is_some_and(|target| has_game_payload(Path::new(target))) {
        status.state = "not-installed".into();
        status.installed = false;
        status.progress = None;
    }
    status
}

fn validate_provider(app_id: u32) -> Result<String, String> {
    let launcher = launcher_dir()?;
    let python = python_executable(&launcher);
    let script = manager_script(&launcher);
    if !script.is_file() {
        return Err("GameAccess provider download manager is missing".into());
    }
    let mut command = Command::new(python);
    apply_runtime_env(&mut command, &launcher);
    command
        .current_dir(&launcher)
        .args([
            script.to_string_lossy().as_ref(),
            "--app-id",
            &app_id.to_string(),
            "--validate",
        ]);
    hide_window(&mut command);
    let output = command
        .output()
        .map_err(|err| format!("Could not validate provider download ownership: {err}"))?;
    let payload = parse_last_json_line(&output.stdout)?;
    if !output.status.success()
        || !payload
            .get("ok")
            .and_then(|value| value.as_bool())
            .unwrap_or(false)
    {
        return Err(payload
            .get("error")
            .and_then(|value| value.as_str())
            .unwrap_or("GameAccess could not resolve a verified provider license")
            .to_string());
    }
    payload
        .get("provider_id")
        .and_then(|value| value.as_str())
        .filter(|value| !value.trim().is_empty())
        .map(str::to_string)
        .ok_or_else(|| "Verified provider result did not include a provider id".to_string())
}

fn provider_download_estimate_blocking(app_id: u32) -> Result<ProviderDownloadStatus, String> {
    if app_id == 0 {
        return Err("Invalid Steam AppID".into());
    }
    let provider_id = validate_provider(app_id)?;
    let launcher = launcher_dir()?;
    let python = python_executable(&launcher);
    let script = manager_script(&launcher);
    let mut command = Command::new(python);
    apply_runtime_env(&mut command, &launcher);
    command
        .current_dir(&launcher)
        .args([
            script.to_string_lossy().as_ref(),
            "--app-id",
            &app_id.to_string(),
            "--estimate",
            "--provider-id",
            &provider_id,
        ]);
    hide_window(&mut command);
    let output = command
        .output()
        .map_err(|err| format!("Could not estimate provider download size: {err}"))?;
    let payload = parse_last_json_line(&output.stdout)?;
    if !output.status.success()
        || !payload
            .get("ok")
            .and_then(|value| value.as_bool())
            .unwrap_or(false)
    {
        return Err(payload
            .get("error")
            .and_then(|value| value.as_str())
            .unwrap_or("Could not estimate provider download size")
            .to_string());
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
        library_index: None,
        error: None,
        job_id: None,
        worker_pid: None,
    })
}

#[tauri::command]
pub async fn provider_download_estimate(app_id: u32) -> Result<ProviderDownloadStatus, String> {
    tauri::async_runtime::spawn_blocking(move || provider_download_estimate_blocking(app_id))
        .await
        .map_err(|err| format!("Provider download estimate task failed: {err}"))?
}

fn new_job_id(app_id: u32) -> String {
    let micros = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_micros();
    format!("provider-{app_id}-{}-{micros}", std::process::id())
}
fn is_active_state(state: &str) -> bool {
    matches!(
        state,
        "requested" | "preparing" | "downloading" | "paused" | "cancelling"
    )
}

fn worker_has_published(status: &ProviderDownloadStatus, job_id: &str) -> bool {
    status.job_id.as_deref() == Some(job_id)
        && (status.worker_pid.is_some() || !is_active_state(&status.state))
}

fn start_provider_download_blocking(
    app_id: u32,
    requested_job_id: Option<String>,
    requested_library_index: Option<u32>,
    requested_provider_id: Option<String>,
    api_base_url: Option<String>,
) -> Result<ProviderDownloadStatus, String> {
    if app_id == 0 {
        return Err("Invalid Steam AppID".into());
    }
    if requested_provider_id.as_ref().is_some_and(|provider_id| {
        provider_id.contains('/') || provider_id.contains('\\') || provider_id == "." || provider_id == ".."
    }) {
        return Err("Invalid provider id for download recovery".into());
    }

    // Only the short check/spawn/publication section is serialized. Worker
    // processes themselves remain fully parallel after this function returns.
    let _start_guard = start_mutex()
        .lock()
        .map_err(|_| "Provider download start lock is poisoned".to_string())?;

    let launcher = launcher_dir()?;

    if let Some(mut status) = provider_download_status(app_id)? {
        if is_active_state(&status.state) {
            #[cfg(target_os = "windows")]
            let worker_valid = match (status.worker_pid, status.job_id.as_deref()) {
                (Some(pid), Some(job_id)) => {
                    verify_worker_process(pid, app_id, job_id, &manager_script(&launcher))?
                }
                _ => false,
            };
            #[cfg(not(target_os = "windows"))]
            let worker_valid = status.worker_pid.is_some() && status.job_id.as_deref().is_some();

            if worker_valid {
                if requested_library_index.is_some()
                    && requested_library_index != status.library_index
                {
                    return Err(
                        "This AppID is already downloading to a different Steam library".into(),
                    );
                }
                return Ok(status);
            }

            status.state = "unknown".into();
            status.error = Some("Previous GameAccess download worker stopped unexpectedly. Starting a new download.".into());
            status.worker_pid = None;
            write_provider_download_status(&launcher, &status)?;
        }
        if status.installed || matches!(status.state.as_str(), "installed" | "prepared") {
            return Ok(status);
        }
    }

    clear_provider_download_status(&launcher, app_id)?;
    let app_id_arg = app_id.to_string();
    let job_id = requested_job_id
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| new_job_id(app_id));

    // A new job owns the AppID immediately. Publish that fact before any
    // backend/network work so a previous job's terminal error can never leak
    // into the new attempt while credentials are being resolved.
    let mut initial = ProviderDownloadStatus {
        app_id,
        state: "requested".into(),
        progress: Some(0.0),
        bytes_downloaded: Some(0),
        bytes_total: None,
        speed_bps: None,
        eta_seconds: None,
        installed: false,
        provider_id: requested_provider_id.clone(),
        prepared_target: None,
        library_index: requested_library_index,
        error: None,
        job_id: Some(job_id.clone()),
        worker_pid: None,
    };
    write_provider_download_status(&launcher, &initial)?;

    let remote_credentials = match api_base_url.filter(|value| !value.trim().is_empty()) {
        Some(api) => match crate::provider_transport::fetch_provider_download_credentials(api, app_id) {
            Ok(credentials) => Some(credentials),
            Err(err) => {
                let _ = clear_provider_download_status(&launcher, app_id);
                return Err(err);
            }
        },
        None => None,
    };
    let effective_provider_id = remote_credentials
        .as_ref()
        .and_then(|credentials| credentials.provider_id.clone())
        .or_else(|| requested_provider_id.clone());
    if effective_provider_id.as_ref().is_some_and(|provider_id| {
        provider_id.contains('/') || provider_id.contains('\\') || provider_id == "." || provider_id == ".."
    }) {
        let _ = clear_provider_download_status(&launcher, app_id);
        return Err("Invalid provider id returned by GameAccess".into());
    }

    initial.state = "preparing".into();
    initial.provider_id = effective_provider_id.clone();
    write_provider_download_status(&launcher, &initial)?;

    let python = python_executable(&launcher);
    let script = manager_script(&launcher);
    if !script.is_file() {
        let _ = clear_provider_download_status(&launcher, app_id);
        return Err("GameAccess provider download manager is missing".into());
    }

    let mut command = Command::new(python);
    apply_runtime_env(&mut command, &launcher);
    command
        .current_dir(&launcher)
        .args([
            script.to_string_lossy().as_ref(),
            "--app-id",
            &app_id_arg,
            "--run",
            "--job-id",
            &job_id,
        ]);
    if let Some(provider_id) = effective_provider_id.as_ref().filter(|value| !value.trim().is_empty()) {
        command.args(["--provider-id", provider_id]);
    }
    if remote_credentials.is_some() {
        command.arg("--credential-stdin");
    }
    let library_index_arg = requested_library_index.map(|value| value.to_string());
    if let Some(ref value) = library_index_arg {
        command.args(["--library-index", value]);
    }
    command
        .stdin(if remote_credentials.is_some() { Stdio::piped() } else { Stdio::null() })
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    hide_window(&mut command);
    let mut child = command
        .spawn()
        .map_err(|err| format!("Could not start provider download: {err}"))?;
    if let Some(credentials) = remote_credentials.as_ref() {
        let provider_id = effective_provider_id
            .as_deref()
            .ok_or_else(|| "Remote download credential did not include a provider id".to_string())?;
        let payload = serde_json::json!({
            "app_id": app_id,
            "provider_id": provider_id,
            "account_name": credentials.account_name,
            "secret": credentials.password,
        });
        let encoded = serde_json::to_vec(&payload)
            .map_err(|_| "Could not encode remote download credential".to_string())?;
        let mut stdin = child.stdin.take()
            .ok_or_else(|| "Could not open provider download credential channel".to_string())?;
        stdin.write_all(&encoded)
            .and_then(|_| stdin.write_all(b"\n"))
            .map_err(|err| format!("Could not deliver provider download credential: {err}"))?;
    }
    let mut started = initial;
    started.worker_pid = Some(child.id());
    if let Some(current) = provider_download_status(app_id)? {
        // The child writes its own PID as soon as it enters the manager. If it
        // already published anything for this job, preserve that newer state;
        // the parent must never overwrite progress/errors with its initial copy.
        if worker_has_published(&current, &job_id) {
            return Ok(current);
        }
    }
    write_provider_download_status(&launcher, &started)?;
    Ok(started)
}

#[tauri::command]
pub async fn start_provider_download(
    app_id: u32,
    job_id: Option<String>,
    library_index: Option<u32>,
    provider_id: Option<String>,
    api_base_url: Option<String>,
) -> Result<ProviderDownloadStatus, String> {
    tauri::async_runtime::spawn_blocking(move || {
        start_provider_download_blocking(app_id, job_id, library_index, provider_id, api_base_url)
    })
    .await
    .map_err(|err| format!("Provider download start task failed: {err}"))?
}

#[cfg(target_os = "windows")]
fn verify_worker_process(
    pid: u32,
    app_id: u32,
    job_id: &str,
    manager: &Path,
) -> Result<bool, String> {
    let manager_name = manager
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("provider_download_manager.py");
    let script = format!("$p=Get-CimInstance Win32_Process -Filter \"ProcessId = {pid}\"; if($null -eq $p){{exit 3}}; [pscustomobject]@{{ProcessId=$p.ProcessId;CommandLine=$p.CommandLine}} | ConvertTo-Json -Compress");
    let mut command = Command::new("powershell.exe");
    command.args([
        "-NoLogo",
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        &script,
    ]);
    hide_window(&mut command);
    let output = command
        .output()
        .map_err(|err| format!("Could not verify provider worker identity: {err}"))?;
    if output.status.code() == Some(3) {
        return Ok(false);
    }
    if !output.status.success() {
        return Err("Could not verify provider worker identity".into());
    }
    let value: serde_json::Value = serde_json::from_slice(&output.stdout)
        .map_err(|err| format!("Worker identity probe returned invalid JSON: {err}"))?;
    let line = value
        .get("CommandLine")
        .and_then(|value| value.as_str())
        .unwrap_or("");
    Ok(line.contains(manager_name)
        && line.contains("--app-id")
        && line.contains(&app_id.to_string())
        && line.contains(job_id))
}

#[cfg(target_os = "windows")]
fn terminate_verified_worker_tree(pid: u32) -> Result<(), String> {
    let mut command = Command::new("taskkill.exe");
    command.args(["/PID", &pid.to_string(), "/T", "/F"]);
    hide_window(&mut command);
    let output = command
        .output()
        .map_err(|err| format!("Could not terminate provider worker: {err}"))?;
    if output.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).trim().to_string())
    }
}

fn cleanup_cancelled_staging(
    launcher: &Path,
    app_id: u32,
    provider_id: Option<&str>,
    job_id: &str,
) {
    let Some(provider_id) = provider_id.filter(|value| !value.trim().is_empty()) else {
        return;
    };
    let args = vec![
        "--discard".into(),
        "--app-id".into(),
        app_id.to_string(),
        "--provider-id".into(),
        provider_id.to_string(),
        "--job-id".into(),
        job_id.to_string(),
    ];
    let _ = reconciliation_command(launcher, &args);
}

fn cancel_provider_download_blocking(
    app_id: u32,
    job_id: String,
) -> Result<ProviderDownloadStatus, String> {
    let launcher = launcher_dir()?;
    let mut status = provider_download_status(app_id)?
        .ok_or_else(|| "No managed provider download exists for this AppID".to_string())?;
    if status.job_id.as_deref() != Some(job_id.as_str()) {
        return Err("Download job identity no longer matches the active work".into());
    }
    if status.installed
        || matches!(
            status.state.as_str(),
            "installed" | "prepared" | "cancelled"
        )
    {
        return Ok(status);
    }
    if !is_active_state(&status.state) {
        return Err(format!(
            "Download cannot be cancelled from state {}",
            status.state
        ));
    }

    status.state = "cancelling".into();
    status.error = None;
    write_provider_download_status(&launcher, &status)?;

    for _ in 0..8 {
        thread::sleep(Duration::from_millis(100));
        if let Some(current) = provider_download_status(app_id)? {
            if current.job_id.as_deref() == Some(job_id.as_str())
                && matches!(current.state.as_str(), "cancelled" | "installed")
            {
                if current.state == "cancelled" {
                    cleanup_cancelled_staging(
                        &launcher,
                        app_id,
                        current.provider_id.as_deref(),
                        &job_id,
                    );
                }
                return Ok(current);
            }
        }
    }

    if let Some(pid) = status.worker_pid {
        #[cfg(target_os = "windows")]
        {
            let manager = manager_script(&launcher);
            if verify_worker_process(pid, app_id, &job_id, &manager)? {
                terminate_verified_worker_tree(pid)?;
            }
        }
        #[cfg(not(target_os = "windows"))]
        return Err("Managed provider cancellation is currently verified only on Windows".into());
    }

    if let Some(current) = provider_download_status(app_id)? {
        if current.job_id.as_deref() == Some(job_id.as_str())
            && (current.installed || current.state == "installed")
        {
            return Ok(current);
        }
    }
    status.state = "cancelled".into();
    status.installed = false;
    status.speed_bps = None;
    status.eta_seconds = None;
    status.error = None;
    status.worker_pid = None;
    write_provider_download_status(&launcher, &status)?;
    cleanup_cancelled_staging(
        &launcher,
        app_id,
        status.provider_id.as_deref(),
        &job_id,
    );
    Ok(status)
}

#[tauri::command]
pub async fn cancel_provider_download(
    app_id: u32,
    job_id: String,
) -> Result<ProviderDownloadStatus, String> {
    tauri::async_runtime::spawn_blocking(move || cancel_provider_download_blocking(app_id, job_id))
        .await
        .map_err(|err| format!("Provider cancellation task failed: {err}"))?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_provider_download_status_shape_with_optional_job_identity() {
        let status: ProviderDownloadStatus = serde_json::from_str(
            r#"{"app_id":1091500,"state":"preparing","progress":null,"bytes_downloaded":null,"bytes_total":null,"installed":false,"provider_id":"provider-001","job_id":"job-1","worker_pid":42,"library_index":2}"#,
        ).expect("status should deserialize");
        assert_eq!(status.app_id, 1_091_500);
        assert_eq!(status.provider_id.as_deref(), Some("provider-001"));
        assert_eq!(status.job_id.as_deref(), Some("job-1"));
        assert_eq!(status.worker_pid, Some(42));
        assert_eq!(status.library_index, Some(2));
        assert!(is_active_state("cancelling"));
        assert!(!is_active_state("cancelled"));
    }

    #[test]
    fn supplied_job_identity_is_stable() {
        let requested = Some("ui-42-fixed".to_string());
        let chosen = requested
            .clone()
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| new_job_id(42));
        assert_eq!(chosen, "ui-42-fixed");
    }

    #[test]
    fn old_status_json_remains_compatible() {
        let status: ProviderDownloadStatus = serde_json::from_str(
            r#"{"app_id":7,"state":"installed","progress":100,"bytes_downloaded":1,"bytes_total":1,"installed":true}"#,
        ).expect("legacy status should deserialize");
        assert_eq!(status.job_id, None);
        assert_eq!(status.worker_pid, None);
        assert_eq!(status.library_index, None);
    }

    #[test]
    fn worker_published_status_wins_parent_start_copy() {
        let status: ProviderDownloadStatus = serde_json::from_str(
            r#"{"app_id":7,"state":"downloading","progress":1,"bytes_downloaded":10,"bytes_total":100,"installed":false,"job_id":"job-7","worker_pid":99}"#,
        ).expect("worker status should deserialize");
        assert!(worker_has_published(&status, "job-7"));
        assert!(!worker_has_published(&status, "other-job"));
    }
}
