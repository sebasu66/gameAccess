use serde::{Deserialize, Serialize};
use std::{
    env, fs,
    path::{Path, PathBuf},
    process::{Command, Stdio},
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
    pub installed: bool,
    #[serde(default)]
    pub provider_id: Option<String>,
    #[serde(default)]
    pub prepared_target: Option<String>,
    #[serde(default)]
    pub error: Option<String>,
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

fn status_path(launcher: &Path, app_id: u32) -> PathBuf {
    launcher
        .join(".gameaccess")
        .join("downloads")
        .join("status")
        .join(format!("app-{app_id}.json"))
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

pub fn provider_download_status(app_id: u32) -> Result<Option<ProviderDownloadStatus>, String> {
    let launcher = launcher_dir()?;
    let path = status_path(&launcher, app_id);
    if !path.is_file() {
        return Ok(None);
    }
    let body = fs::read_to_string(path)
        .map_err(|err| format!("Could not read provider download status: {err}"))?;
    let status: ProviderDownloadStatus = serde_json::from_str(&body)
        .map_err(|err| format!("Provider download status is invalid: {err}"))?;
    Ok(Some(status))
}

fn validate_provider(app_id: u32) -> Result<String, String> {
    let launcher = launcher_dir()?;
    let python = python_executable(&launcher);
    let script = manager_script(&launcher);
    if !script.is_file() {
        return Err("GameAccess provider download manager is missing".into());
    }

    let mut command = Command::new(python);
    command
        .current_dir(&launcher)
        .env("PYTHONUTF8", "1")
        .env("PYTHONIOENCODING", "utf-8")
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

#[tauri::command]
pub fn start_provider_download(app_id: u32) -> Result<ProviderDownloadStatus, String> {
    if app_id == 0 {
        return Err("Invalid Steam AppID".into());
    }
    if let Some(status) = provider_download_status(app_id)? {
        if matches!(
            status.state.as_str(),
            "requested" | "preparing" | "downloading" | "paused"
        ) {
            return Ok(status);
        }
    }

    let provider_id = validate_provider(app_id)?;
    let launcher = launcher_dir()?;
    let python = python_executable(&launcher);
    let script = manager_script(&launcher);
    let app_id_arg = app_id.to_string();

    let mut command = Command::new(python);
    command
        .current_dir(&launcher)
        .env("PYTHONUTF8", "1")
        .env("PYTHONIOENCODING", "utf-8")
        .args([
            script.to_string_lossy().as_ref(),
            "--app-id",
            &app_id_arg,
            "--run",
            "--provider-id",
            &provider_id,
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    hide_window(&mut command);
    command
        .spawn()
        .map_err(|err| format!("Could not start provider download: {err}"))?;

    Ok(ProviderDownloadStatus {
        app_id,
        state: "preparing".into(),
        progress: None,
        bytes_downloaded: None,
        bytes_total: None,
        installed: false,
        provider_id: Some(provider_id),
        prepared_target: None,
        error: None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_provider_download_status_shape() {
        let status: ProviderDownloadStatus = serde_json::from_str(
            r#"{"app_id":1091500,"state":"preparing","progress":null,"bytes_downloaded":null,"bytes_total":null,"installed":false,"provider_id":"provider-001"}"#,
        )
        .expect("status should deserialize");
        assert_eq!(status.app_id, 1_091_500);
        assert_eq!(status.provider_id.as_deref(), Some("provider-001"));
        assert!(!status.installed);
    }
}
