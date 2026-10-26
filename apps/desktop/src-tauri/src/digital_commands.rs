//! Digital commands. Extracted without changing IPC contracts.
#[cfg(test)]
use std::env;
#[cfg(test)]
use std::fs;
use std::process::Command;
use std::io::{Write};
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;
use crate::launcher_runtime::{find_launcher_dir, find_launcher_python, launcher_data_dir};

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

/// The progress a freeze or thaw writes while it works (`.cache/digital_frozen/<appid>.progress.json` in the launcher's
/// data); `None` when that game has none. Read a few times a second by the freeze console, so no Python is started.
#[tauri::command]
pub(crate) async fn freeze_progress(app_id: u32) -> Result<Option<serde_json::Value>, String> {
    let launcher = find_launcher_dir().ok_or_else(|| "Could not locate launcher directory".to_string())?;
    let path = launcher_data_dir(&launcher).join(".cache").join("digital_frozen").join(format!("{app_id}.progress.json"));
    Ok(std::fs::read_to_string(path).ok().and_then(|text| serde_json::from_str(&text).ok()))
}

// Downloads are started, paused, resumed and cancelled by the launcher's Download Manager (download_queue.rs).

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
mod digital_runtime_tests {
    use super::*;
    use crate::launcher_runtime::launcher_below;
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
}
