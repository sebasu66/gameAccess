use serde::Serialize;
use serde_json::Value;
use std::{
    env, fs,
    path::PathBuf,
    process::Command,
    sync::Mutex,
};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

pub struct AutomationState {
    script_path: Option<PathBuf>,
    output_dir: Mutex<Option<PathBuf>>,
}

#[derive(Serialize)]
pub struct AutomationConfig {
    enabled: bool,
    script_path: Option<String>,
    output_dir: Option<String>,
    script: Option<Value>,
}

fn arg_value(name: &str) -> Option<String> {
    let args = env::args().collect::<Vec<_>>();
    for (index, arg) in args.iter().enumerate() {
        if arg == name {
            return args.get(index + 1).cloned();
        }
        let prefix = format!("{name}=");
        if let Some(value) = arg.strip_prefix(&prefix) {
            return Some(value.to_string());
        }
    }
    None
}

fn local_appdata_root() -> PathBuf {
    env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(env::temp_dir)
        .join("GameAccess")
        .join("automation")
}

fn default_script_path() -> Option<PathBuf> {
    let candidate = local_appdata_root().join("script.json");
    candidate.is_file().then_some(candidate)
}

fn make_default_output_dir() -> PathBuf {
    let stamp = chrono::Local::now().format("%Y%m%d-%H%M%S").to_string();
    local_appdata_root().join("runs").join(stamp)
}

impl AutomationState {
    pub fn from_process() -> Self {
        let script_path = arg_value("--automation-script")
            .or_else(|| env::var("GAMEACCESS_AUTOMATION_SCRIPT").ok())
            .map(PathBuf::from)
            .or_else(default_script_path);

        let output_dir = if script_path.is_some() {
            Some(
                arg_value("--automation-output")
                    .or_else(|| env::var("GAMEACCESS_AUTOMATION_OUTPUT").ok())
                    .map(PathBuf::from)
                    .unwrap_or_else(make_default_output_dir),
            )
        } else {
            None
        };

        if let Some(path) = output_dir.as_ref() {
            let _ = fs::create_dir_all(path);
        }

        Self {
            script_path,
            output_dir: Mutex::new(output_dir),
        }
    }
}

fn state_output_dir(state: &AutomationState) -> Result<PathBuf, String> {
    let output = state
        .output_dir
        .lock()
        .map_err(|_| "Automation output state is unavailable".to_string())?
        .clone()
        .ok_or_else(|| "Automation mode is not enabled".to_string())?;
    fs::create_dir_all(&output)
        .map_err(|err| format!("Could not create automation output directory: {err}"))?;
    Ok(output)
}

#[tauri::command]
pub fn automation_config(state: tauri::State<AutomationState>) -> Result<AutomationConfig, String> {
    let Some(script_path) = state.script_path.clone() else {
        return Ok(AutomationConfig {
            enabled: false,
            script_path: None,
            output_dir: None,
            script: None,
        });
    };

    let body = fs::read_to_string(&script_path).map_err(|err| {
        format!(
            "Could not read automation script '{}': {err}",
            script_path.to_string_lossy()
        )
    })?;
    let script: Value = serde_json::from_str(&body).map_err(|err| {
        format!(
            "Automation script '{}' is not valid JSON: {err}",
            script_path.to_string_lossy()
        )
    })?;
    let output_dir = state_output_dir(&state)?;

    Ok(AutomationConfig {
        enabled: true,
        script_path: Some(script_path.to_string_lossy().to_string()),
        output_dir: Some(output_dir.to_string_lossy().to_string()),
        script: Some(script),
    })
}

fn safe_snapshot_name(label: &str) -> String {
    let cleaned: String = label
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
                ch
            } else {
                '-'
            }
        })
        .collect();
    cleaned.trim_matches('-').to_lowercase()
}

#[tauri::command]
pub fn capture_automation_screenshot(
    label: String,
    state: tauri::State<AutomationState>,
) -> Result<String, String> {
    let output_dir = state_output_dir(&state)?;
    let name = safe_snapshot_name(&label);
    if name.is_empty() {
        return Err("Automation screenshot label is empty".into());
    }
    let output_path = output_dir.join(format!("{name}.png"));

    #[cfg(target_os = "windows")]
    {
        let escaped_path = output_path.to_string_lossy().replace('\'', "''");
        let app_pid = std::process::id();
        let script = format!(
            r#"Add-Type -AssemblyName System.Drawing; Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class GameAccessAutomationWindow {{
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  public struct RECT {{ public int Left; public int Top; public int Right; public int Bottom; }}
}}
'@; [GameAccessAutomationWindow]::SetProcessDPIAware()|Out-Null; $h=(Get-Process -Id {app_pid}).MainWindowHandle; if($h -eq 0){{throw 'GameAccess window handle is unavailable'}}; $r=New-Object GameAccessAutomationWindow+RECT; [GameAccessAutomationWindow]::GetWindowRect($h,[ref]$r)|Out-Null; $w=$r.Right-$r.Left; $hgt=$r.Bottom-$r.Top; if($w -le 0 -or $hgt -le 0){{throw 'Invalid GameAccess window size'}}; $bmp=New-Object System.Drawing.Bitmap($w,$hgt); $g=[System.Drawing.Graphics]::FromImage($bmp); $g.CopyFromScreen($r.Left,$r.Top,0,0,$bmp.Size); $bmp.Save('{escaped_path}',[System.Drawing.Imaging.ImageFormat]::Png); $g.Dispose(); $bmp.Dispose()"#
        );
        let result = Command::new("powershell.exe")
            .args([
                "-NoLogo",
                "-NoProfile",
                "-ExecutionPolicy",
                "Bypass",
                "-Command",
                &script,
            ])
            .creation_flags(CREATE_NO_WINDOW)
            .output()
            .map_err(|err| format!("Could not capture automation screenshot: {err}"))?;
        if !result.status.success() {
            return Err(String::from_utf8_lossy(&result.stderr).trim().to_string());
        }
    }

    #[cfg(not(target_os = "windows"))]
    return Err("Automation screenshots are currently implemented for Windows".into());

    Ok(output_path.to_string_lossy().to_string())
}

#[tauri::command]
pub fn finish_automation(
    results: Value,
    state: tauri::State<AutomationState>,
) -> Result<String, String> {
    let output_dir = state_output_dir(&state)?;
    let target = output_dir.join("result.json");
    let temporary = output_dir.join("result.json.tmp");
    let body = serde_json::to_string_pretty(&results).map_err(|err| err.to_string())?;
    fs::write(&temporary, body)
        .map_err(|err| format!("Could not write automation result: {err}"))?;
    if target.exists() {
        fs::remove_file(&target)
            .map_err(|err| format!("Could not replace previous automation result: {err}"))?;
    }
    fs::rename(&temporary, &target)
        .map_err(|err| format!("Could not publish automation result: {err}"))?;
    Ok(target.to_string_lossy().to_string())
}
