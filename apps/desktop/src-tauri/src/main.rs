#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::Serialize;
use std::{
    env, fs,
    path::{Path, PathBuf},
    process::Command,
    sync::Mutex,
};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

#[derive(Serialize)]
struct SteamDownloadStatus {
    app_id: u32,
    state: String,
    progress: Option<f64>,
    bytes_downloaded: Option<u64>,
    bytes_total: Option<u64>,
    installed: bool,
}

#[derive(Serialize)]
struct MachineProfile {
    memory_gb: Option<f64>,
    cpu: Option<String>,
    gpus: Vec<String>,
}

#[derive(Serialize)]
struct SteamAccountSwitchResult {
    ok: bool,
    stage: String,
    message: String,
}

#[derive(Serialize)]
struct RuntimePrerequisites {
    runtime_ok: bool,
    steam_installed: bool,
    steam_path: Option<String>,
    account_file_present: bool,
    remembered_accounts: usize,
}

#[derive(Default)]
struct VisualDebugState {
    session_dir: Mutex<Option<PathBuf>>,
}

#[derive(Serialize)]
struct VisualDebugConfig {
    enabled: bool,
    session_dir: Option<String>,
}

fn visual_debug_session_dir() -> Option<PathBuf> {
    let enabled = env::args().any(|arg| {
        matches!(
            arg.as_str(),
            "--visual-debug" | "-visual-debug" | "--auto-snapshot" | "-auto-snapshot"
        )
    });
    if !enabled {
        return None;
    }

    let timestamp = chrono::Local::now().format("%Y%m%d-%H%M%S").to_string();
    let project_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(|desktop| desktop.parent())
        .and_then(|apps| apps.parent())
        .map(PathBuf::from)
        .unwrap_or_else(|| env::current_dir().unwrap_or_else(|_| PathBuf::from(".")));
    let session_dir = project_root.join("debug").join("visual").join(timestamp);
    fs::create_dir_all(&session_dir).ok()?;
    Some(session_dir)
}

#[tauri::command]
fn visual_debug_config(state: tauri::State<VisualDebugState>) -> VisualDebugConfig {
    let session_dir = state
        .session_dir
        .lock()
        .ok()
        .and_then(|value| value.clone());
    VisualDebugConfig {
        enabled: session_dir.is_some(),
        session_dir: session_dir.map(|path| path.to_string_lossy().to_string()),
    }
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
fn capture_visual_debug(
    label: String,
    state: tauri::State<VisualDebugState>,
) -> Result<String, String> {
    let session_dir = state
        .session_dir
        .lock()
        .map_err(|_| "Visual debug state is unavailable".to_string())?
        .clone()
        .ok_or_else(|| "Visual debug mode is not enabled".to_string())?;
    let name = safe_snapshot_name(&label);
    if name.is_empty() {
        return Err("Snapshot label is empty".into());
    }
    let output_path = session_dir.join(format!("{name}.png"));

    #[cfg(target_os = "windows")]
    {
        let escaped_path = output_path.to_string_lossy().replace('\'', "''");
        let app_pid = std::process::id();
        let script = format!(
            r#"Add-Type -AssemblyName System.Drawing; Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class VisualDebugWindow {{
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  public struct RECT {{ public int Left; public int Top; public int Right; public int Bottom; }}
}}
'@; [VisualDebugWindow]::SetProcessDPIAware()|Out-Null; $h=(Get-Process -Id {app_pid}).MainWindowHandle; if($h -eq 0){{throw 'gameAccess window handle is unavailable'}}; $r=New-Object VisualDebugWindow+RECT; [VisualDebugWindow]::GetWindowRect($h,[ref]$r)|Out-Null; $w=$r.Right-$r.Left; $hgt=$r.Bottom-$r.Top; if($w -le 0 -or $hgt -le 0){{throw 'Invalid gameAccess window size'}}; $bmp=New-Object System.Drawing.Bitmap($w,$hgt); $g=[System.Drawing.Graphics]::FromImage($bmp); $g.CopyFromScreen($r.Left,$r.Top,0,0,$bmp.Size); $bmp.Save('{escaped_path}',[System.Drawing.Imaging.ImageFormat]::Png); $g.Dispose(); $bmp.Dispose()"#
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
            .map_err(|err| format!("Could not capture visual debug snapshot: {err}"))?;
        if !result.status.success() {
            return Err(String::from_utf8_lossy(&result.stderr).trim().to_string());
        }
    }

    #[cfg(not(target_os = "windows"))]
    return Err("Visual debug capture is currently implemented for Windows".into());

    Ok(output_path.to_string_lossy().to_string())
}

#[tauri::command]
fn finish_visual_debug(
    results: serde_json::Value,
    state: tauri::State<VisualDebugState>,
) -> Result<String, String> {
    let session_dir = state
        .session_dir
        .lock()
        .map_err(|_| "Visual debug state is unavailable".to_string())?
        .clone()
        .ok_or_else(|| "Visual debug mode is not enabled".to_string())?;
    let manifest = session_dir.join("manifest.json");
    let body = serde_json::to_string_pretty(&results).map_err(|err| err.to_string())?;
    fs::write(&manifest, body)
        .map_err(|err| format!("Could not write visual debug manifest: {err}"))?;
    Ok(manifest.to_string_lossy().to_string())
}

#[tauri::command]
fn set_visual_debug_viewport(mode: String, window: tauri::Window) -> Result<(), String> {
    match mode.as_str() {
        "medium" => {
            window.unmaximize().map_err(|err| err.to_string())?;
            window
                .set_size(tauri::LogicalSize::new(1100.0, 760.0))
                .map_err(|err| err.to_string())?;
            window.center().map_err(|err| err.to_string())?;
        }
        "maximized" => window.maximize().map_err(|err| err.to_string())?,
        _ => return Err(format!("Unsupported visual debug viewport: {mode}")),
    }
    Ok(())
}

#[cfg(target_os = "windows")]
fn steam_registry_candidates() -> Vec<PathBuf> {
    let mut paths = Vec::new();
    let queries = [
        ("HKCU\\Software\\Valve\\Steam", "SteamPath"),
        ("HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam", "InstallPath"),
        ("HKLM\\SOFTWARE\\Valve\\Steam", "InstallPath"),
    ];
    for (key, value_name) in queries {
        let output = Command::new("reg.exe")
            .args(["query", key, "/v", value_name])
            .creation_flags(CREATE_NO_WINDOW)
            .output();
        let Ok(output) = output else { continue };
        if !output.status.success() {
            continue;
        }
        let stdout = String::from_utf8_lossy(&output.stdout);
        for line in stdout.lines() {
            if !line.contains(value_name) {
                continue;
            }
            let value = line
                .split_whitespace()
                .skip(2)
                .collect::<Vec<_>>()
                .join(" ");
            if !value.trim().is_empty() {
                paths.push(PathBuf::from(value.trim()).join("steam.exe"));
            }
        }
    }
    paths
}
#[cfg(not(target_os = "windows"))]
fn steam_registry_candidates() -> Vec<PathBuf> {
    Vec::new()
}
fn steam_path_candidates() -> Vec<PathBuf> {
    let mut paths = steam_registry_candidates();
    if let Ok(value) = env::var("PROGRAMFILES(X86)") {
        paths.push(PathBuf::from(value).join("Steam").join("steam.exe"));
    }
    if let Ok(value) = env::var("PROGRAMFILES") {
        paths.push(PathBuf::from(value).join("Steam").join("steam.exe"));
    }
    paths.push(PathBuf::from(r"C:\Steam\steam.exe"));
    paths
}
fn find_steam_exe() -> Option<PathBuf> {
    steam_path_candidates()
        .into_iter()
        .find(|path| path.is_file())
}
fn remembered_steam_accounts(steam_exe: &Path) -> (bool, usize) {
    let Some(root) = steam_exe.parent() else {
        return (false, 0);
    };
    let loginusers = root.join("config").join("loginusers.vdf");
    let Ok(text) = fs::read_to_string(&loginusers) else {
        return (loginusers.is_file(), 0);
    };
    let count = text
        .lines()
        .filter(|line| {
            let lower = line.to_ascii_lowercase();
            if !lower.contains("rememberpassword") {
                return false;
            }
            let values: Vec<&str> = line.split('"').collect();
            values.len() >= 4 && values[3].trim() == "1"
        })
        .count();
    (true, count)
}
#[tauri::command]
fn steam_installed() -> bool {
    find_steam_exe().is_some()
}
#[tauri::command]
fn runtime_prerequisites() -> RuntimePrerequisites {
    let Some(steam_exe) = find_steam_exe() else {
        return RuntimePrerequisites {
            runtime_ok: true,
            steam_installed: false,
            steam_path: None,
            account_file_present: false,
            remembered_accounts: 0,
        };
    };
    let (account_file_present, remembered_accounts) = remembered_steam_accounts(&steam_exe);
    RuntimePrerequisites {
        runtime_ok: true,
        steam_installed: true,
        steam_path: steam_exe.parent().map(|p| p.to_string_lossy().to_string()),
        account_file_present,
        remembered_accounts,
    }
}
#[tauri::command]
fn open_steam_client() -> Result<(), String> {
    let steam = find_steam_exe()
        .ok_or_else(|| "Steam no está instalado o no pudo ser localizado.".to_string())?;
    #[cfg(target_os = "windows")]
    Command::new(steam)
        .creation_flags(CREATE_NO_WINDOW)
        .spawn()
        .map_err(|e| format!("No pudimos abrir Steam: {e}"))?;
    #[cfg(not(target_os = "windows"))]
    Command::new(steam)
        .spawn()
        .map_err(|e| format!("No pudimos abrir Steam: {e}"))?;
    Ok(())
}

fn open_steam_uri(uri: &str) -> Result<(), String> {
    if !uri.starts_with("steam://install/") && !uri.starts_with("steam://run/") {
        return Err("Unsupported Steam URI".into());
    }

    #[cfg(target_os = "windows")]
    {
        if let Some(steam) = find_steam_exe() {
            Command::new(steam)
                .arg(uri)
                .creation_flags(CREATE_NO_WINDOW)
                .spawn()
                .map_err(|err| format!("Could not open Steam: {err}"))?;
        } else {
            Command::new("explorer.exe")
                .arg(uri)
                .creation_flags(CREATE_NO_WINDOW)
                .spawn()
                .map_err(|err| format!("Could not open Steam protocol: {err}"))?;
        }
        Ok(())
    }

    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(uri)
            .spawn()
            .map_err(|err| format!("Could not open Steam: {err}"))?;
        return Ok(());
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        Command::new("xdg-open")
            .arg(uri)
            .spawn()
            .map_err(|err| format!("Could not open Steam: {err}"))?;
        return Ok(());
    }
}

#[tauri::command]
fn open_steam_install(app_id: u32) -> Result<(), String> {
    open_steam_uri(&format!("steam://install/{app_id}"))
}

#[tauri::command]
fn open_steam_run(app_id: u32) -> Result<(), String> {
    open_steam_uri(&format!("steam://run/{app_id}"))
}

fn quoted_value(text: &str, key: &str) -> Option<String> {
    for line in text.lines() {
        let parts: Vec<&str> = line.split('"').collect();
        if parts.len() >= 4 && parts[1].eq_ignore_ascii_case(key) {
            return Some(parts[3].replace("\\\\", "\\"));
        }
    }
    None
}

fn steam_library_roots() -> Vec<PathBuf> {
    let mut roots = Vec::new();
    if let Some(steam_exe) = find_steam_exe() {
        if let Some(root) = steam_exe.parent() {
            roots.push(root.to_path_buf());
            let libraries = root.join("steamapps").join("libraryfolders.vdf");
            if let Ok(text) = fs::read_to_string(libraries) {
                for line in text.lines() {
                    let parts: Vec<&str> = line.split('"').collect();
                    if parts.len() >= 4 && parts[1].eq_ignore_ascii_case("path") {
                        let candidate = PathBuf::from(parts[3].replace("\\\\", "\\"));
                        if !roots.iter().any(|existing| existing == &candidate) {
                            roots.push(candidate);
                        }
                    }
                }
            }
        }
    }
    roots
}

fn manifest_for(app_id: u32) -> Option<PathBuf> {
    steam_library_roots()
        .into_iter()
        .map(|root| {
            root.join("steamapps")
                .join(format!("appmanifest_{app_id}.acf"))
        })
        .find(|path| path.is_file())
}

#[tauri::command]
fn steam_download_status(app_id: u32) -> SteamDownloadStatus {
    let Some(manifest) = manifest_for(app_id) else {
        return SteamDownloadStatus {
            app_id,
            state: "not-installed".into(),
            progress: None,
            bytes_downloaded: None,
            bytes_total: None,
            installed: false,
        };
    };

    let Ok(text) = fs::read_to_string(&manifest) else {
        return SteamDownloadStatus {
            app_id,
            state: "unknown".into(),
            progress: None,
            bytes_downloaded: None,
            bytes_total: None,
            installed: false,
        };
    };

    let state_flags = quoted_value(&text, "StateFlags")
        .and_then(|v| v.parse::<u32>().ok())
        .unwrap_or(0);
    let bytes_total = quoted_value(&text, "BytesToDownload").and_then(|v| v.parse::<u64>().ok());
    let bytes_downloaded =
        quoted_value(&text, "BytesDownloaded").and_then(|v| v.parse::<u64>().ok());
    let installed = state_flags & 4 == 4;
    let progress = match (bytes_downloaded, bytes_total) {
        (Some(done), Some(total)) if total > 0 => {
            Some(((done as f64 / total as f64) * 100.0).clamp(0.0, 100.0))
        }
        _ if installed => Some(100.0),
        _ => None,
    };
    let state = if installed {
        "installed"
    } else if bytes_total.unwrap_or(0) > 0 {
        "downloading"
    } else {
        "preparing"
    };

    SteamDownloadStatus {
        app_id,
        state: state.into(),
        progress,
        bytes_downloaded,
        bytes_total,
        installed,
    }
}

#[cfg(target_os = "windows")]
fn powershell_json(script: &str) -> Option<serde_json::Value> {
    let output = Command::new("powershell.exe")
        .args([
            "-NoLogo",
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            script,
        ])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    serde_json::from_slice(&output.stdout).ok()
}

#[tauri::command]
fn machine_profile() -> MachineProfile {
    #[cfg(target_os = "windows")]
    {
        let script = "$cs=Get-CimInstance Win32_ComputerSystem; $cpu=(Get-CimInstance Win32_Processor | Select-Object -First 1 -ExpandProperty Name); $gpu=@(Get-CimInstance Win32_VideoController | Select-Object -ExpandProperty Name); [pscustomobject]@{memory_gb=[math]::Round($cs.TotalPhysicalMemory/1GB,1);cpu=$cpu;gpus=$gpu}|ConvertTo-Json -Compress";
        if let Some(value) = powershell_json(script) {
            let memory_gb = value.get("memory_gb").and_then(|v| v.as_f64());
            let cpu = value
                .get("cpu")
                .and_then(|v| v.as_str())
                .map(str::to_string);
            let gpus = match value.get("gpus") {
                Some(serde_json::Value::Array(values)) => values
                    .iter()
                    .filter_map(|v| v.as_str().map(str::to_string))
                    .collect(),
                Some(serde_json::Value::String(value)) => vec![value.clone()],
                _ => Vec::new(),
            };
            return MachineProfile {
                memory_gb,
                cpu,
                gpus,
            };
        }
    }

    MachineProfile {
        memory_gb: None,
        cpu: None,
        gpus: Vec::new(),
    }
}

#[cfg(target_os = "windows")]
fn launcher_dir() -> Option<PathBuf> {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    manifest_dir
        .parent()
        .and_then(|desktop| desktop.parent())
        .map(|apps| apps.join("launcher"))
}

#[tauri::command]
fn local_steam_pool() -> Result<serde_json::Value, String> {
    read_local_steam_pool()
}

#[tauri::command]
fn verify_local_steam_inventory() -> Result<serde_json::Value, String> {
    let launcher =
        launcher_dir().ok_or_else(|| "Could not locate the local Steam adapter".to_string())?;
    let venv_python = launcher.join(".venv").join("Scripts").join("python.exe");
    let python = if venv_python.is_file() {
        venv_python
    } else {
        PathBuf::from("python")
    };
    let code = r#"import json; import steam_verified_inventory as inventory; from steam_verified_sync_v5 import deterministic_switch; inventory._switch=lambda identity,attempts=2: deterministic_switch(identity); result=inventory.verify_all_remembered_accounts(save=True); print(json.dumps(result,ensure_ascii=False))"#;
    let output = Command::new(&python)
        .current_dir(&launcher)
        .env("PYTHONUTF8", "1")
        .env("PYTHONIOENCODING", "utf-8")
        .args(["-c", code])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map_err(|err| format!("Could not verify Steam ownership: {err}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if stderr.is_empty() {
            "Steam ownership verification failed".into()
        } else {
            stderr
        });
    }
    serde_json::from_slice(&output.stdout)
        .map_err(|err| format!("Steam ownership verification returned invalid data: {err}"))
}

fn read_local_steam_pool() -> Result<serde_json::Value, String> {
    let launcher =
        launcher_dir().ok_or_else(|| "Could not locate the local Steam adapter".to_string())?;
    let venv_python = launcher.join(".venv").join("Scripts").join("python.exe");
    let python = if venv_python.is_file() {
        venv_python
    } else {
        PathBuf::from("python")
    };
    let output = Command::new(&python)
        .current_dir(&launcher)
        .env("PYTHONUTF8", "1")
        .env("PYTHONIOENCODING", "utf-8")
        .args(["pool_sync.py", "--dry-run"])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map_err(|err| format!("Could not run the verified Steam inventory adapter: {err}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if stderr.is_empty() {
            "Verified Steam inventory adapter failed".into()
        } else {
            stderr
        });
    }
    let value: serde_json::Value = serde_json::from_slice(&output.stdout)
        .map_err(|err| format!("Verified Steam inventory returned invalid data: {err}"))?;
    Ok(value.get("pool").cloned().unwrap_or(value))
}

#[cfg(test)]
mod tests {
    use super::read_local_steam_pool;

    #[test]
    fn local_steam_pool_contains_real_games_and_accounts() {
        let pool = read_local_steam_pool().expect("local Steam pool should load");
        let games = pool
            .get("games")
            .and_then(|value| value.as_array())
            .expect("games array");
        let accounts = pool
            .get("accounts")
            .and_then(|value| value.as_array())
            .expect("accounts array");
        assert!(
            !games.is_empty(),
            "local Steam pool must not silently become empty"
        );
        assert!(
            !accounts.is_empty(),
            "remembered Steam accounts must be present"
        );
        assert!(games.iter().all(|game| game
            .get("app_id")
            .and_then(|value| value.as_u64())
            .unwrap_or(0)
            > 0));
    }
}

#[tauri::command]
fn switch_steam_account(account_label: String) -> SteamAccountSwitchResult {
    if account_label.trim().is_empty() {
        return SteamAccountSwitchResult {
            ok: false,
            stage: "input".into(),
            message: "No Steam account label was supplied".into(),
        };
    }

    #[cfg(target_os = "windows")]
    {
        let Some(launcher) = launcher_dir() else {
            return SteamAccountSwitchResult {
                ok: false,
                stage: "adapter".into(),
                message: "Could not locate the local Steam adapter".into(),
            };
        };
        let venv_python = launcher.join(".venv").join("Scripts").join("python.exe");
        let python = if venv_python.is_file() {
            venv_python
        } else {
            PathBuf::from("python")
        };
        let code = r#"import json,sys; from steam_pool import remembered_account_identities,active_user_id32; from steam_verified_sync_v5 import deterministic_switch; target=sys.argv[1].strip().casefold(); identity=next((i for i in remembered_account_identities() if str(i.get('account_name') or '').casefold()==target or str(i.get('display_name') or '').casefold()==target),None); ok,msg=(False,'Steam account is not remembered on this PC') if identity is None else deterministic_switch(identity); expected=None if identity is None else identity.get('user_id32'); active=active_user_id32(); verified=bool(ok and expected and active==expected); print(json.dumps({'ok':verified,'stage':'ready' if verified else 'switch','message':msg,'expected_user_id32':expected,'active_user_id32':active}, ensure_ascii=False))"#;
        let output = Command::new(&python)
            .current_dir(&launcher)
            .env("PYTHONUTF8", "1")
            .env("PYTHONIOENCODING", "utf-8")
            .args(["-c", code, account_label.as_str()])
            .creation_flags(CREATE_NO_WINDOW)
            .output();

        let output = match output {
            Ok(output) => output,
            Err(err) => {
                return SteamAccountSwitchResult {
                    ok: false,
                    stage: "adapter".into(),
                    message: format!("Could not run the local Steam UI adapter: {err}"),
                }
            }
        };

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            return SteamAccountSwitchResult {
                ok: false,
                stage: "adapter".into(),
                message: if stderr.is_empty() {
                    "Steam UI adapter failed".into()
                } else {
                    stderr
                },
            };
        }

        let parsed: serde_json::Value = match serde_json::from_slice(&output.stdout) {
            Ok(value) => value,
            Err(err) => {
                return SteamAccountSwitchResult {
                    ok: false,
                    stage: "adapter".into(),
                    message: format!("Steam UI adapter returned invalid data: {err}"),
                }
            }
        };
        let ok = parsed
            .get("ok")
            .and_then(|value| value.as_bool())
            .unwrap_or(false);
        let stage = parsed
            .get("stage")
            .and_then(|value| value.as_str())
            .unwrap_or("switch")
            .to_string();
        let message = parsed
            .get("message")
            .and_then(|value| value.as_str())
            .unwrap_or("Steam account switch finished")
            .to_string();
        SteamAccountSwitchResult { ok, stage, message }
    }

    #[cfg(not(target_os = "windows"))]
    {
        SteamAccountSwitchResult {
            ok: false,
            stage: "platform".into(),
            message: "Remembered Steam account switching is currently implemented only on Windows"
                .into(),
        }
    }
}

#[tauri::command]
fn steam_store_metadata(app_id: u32) -> Result<serde_json::Value, String> {
    #[cfg(target_os = "windows")]
    {
        let url = format!(
            "https://store.steampowered.com/api/appdetails?appids={app_id}&cc=AR&l=spanish"
        );
        let script = format!("[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; $ProgressPreference='SilentlyContinue'; $headers=@{{'User-Agent'='gameAccess/0.1'}}; $result=Invoke-RestMethod -Uri '{}' -Headers $headers -TimeoutSec 20; $result | ConvertTo-Json -Depth 32 -Compress", url);
        let output = Command::new("powershell.exe")
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
            .map_err(|err| format!("Could not query Steam Store metadata: {err}"))?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            return Err(if stderr.is_empty() {
                "Steam Store metadata request failed".into()
            } else {
                stderr
            });
        }
        let parsed: serde_json::Value = serde_json::from_slice(&output.stdout)
            .map_err(|err| format!("Steam Store returned invalid JSON: {err}"))?;
        let key = app_id.to_string();
        let entry = parsed.get(&key).ok_or_else(|| {
            "Steam Store response did not contain the requested AppID".to_string()
        })?;
        if !entry
            .get("success")
            .and_then(|value| value.as_bool())
            .unwrap_or(false)
        {
            return Err("Steam Store did not return metadata for this AppID".into());
        }
        entry
            .get("data")
            .cloned()
            .ok_or_else(|| "Steam Store response did not contain game data".to_string())
    }
    #[cfg(not(target_os = "windows"))]
    {
        Err("Steam Store metadata bridge is currently implemented for Windows".into())
    }
}

fn main() {
    let visual_debug_dir = visual_debug_session_dir();
    tauri::Builder::default()
        .manage(VisualDebugState {
            session_dir: Mutex::new(visual_debug_dir),
        })
        .invoke_handler(tauri::generate_handler![
            steam_installed,
            runtime_prerequisites,
            open_steam_client,
            open_steam_install,
            open_steam_run,
            steam_download_status,
            steam_store_metadata,
            local_steam_pool,
            verify_local_steam_inventory,
            machine_profile,
            switch_steam_account,
            visual_debug_config,
            capture_visual_debug,
            finish_visual_debug,
            set_visual_debug_viewport
        ])
        .run(tauri::generate_context!())
        .expect("error while running gameAccess");
}
