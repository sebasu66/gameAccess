use serde::Serialize;
use std::{
    collections::HashSet,
    env, fs,
    path::{Path, PathBuf},
    process::Command,
};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

#[derive(Clone, Debug, Serialize)]
pub struct SteamDownloadStatus {
    pub app_id: u32,
    pub state: String,
    pub progress: Option<f64>,
    pub bytes_downloaded: Option<u64>,
    pub bytes_total: Option<u64>,
    pub installed: bool,
}

#[derive(Clone, Debug, Serialize)]
pub struct MachineProfile {
    pub memory_gb: Option<f64>,
    pub cpu: Option<String>,
    pub gpus: Vec<String>,
}

#[derive(Clone, Debug, Serialize)]
pub struct SteamAccountSwitchResult {
    pub ok: bool,
    pub stage: String,
    pub message: String,
}

#[derive(Clone, Debug, Serialize)]
pub struct RuntimePrerequisites {
    pub runtime_ok: bool,
    pub steam_installed: bool,
    pub steam_path: Option<String>,
    pub account_file_present: bool,
    pub remembered_accounts: usize,
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
pub fn steam_installed() -> bool {
    find_steam_exe().is_some()
}
pub fn runtime_prerequisites() -> RuntimePrerequisites {
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
pub fn open_steam_client() -> Result<(), String> {
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

pub fn open_steam_install(app_id: u32) -> Result<(), String> {
    open_steam_uri(&format!("steam://install/{app_id}"))
}

pub fn open_steam_run(app_id: u32) -> Result<(), String> {
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

pub fn steam_download_status(app_id: u32) -> SteamDownloadStatus {
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

pub fn steam_installed_app_ids() -> Vec<u32> {
    let mut ids = HashSet::new();
    for root in steam_library_roots() {
        let steamapps = root.join("steamapps");
        let Ok(entries) = fs::read_dir(steamapps) else {
            continue;
        };
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            let Some(raw_id) = name
                .strip_prefix("appmanifest_")
                .and_then(|value| value.strip_suffix(".acf"))
            else {
                continue;
            };
            let Ok(app_id) = raw_id.parse::<u32>() else {
                continue;
            };
            let Ok(body) = fs::read_to_string(entry.path()) else {
                continue;
            };
            let state_flags = quoted_value(&body, "StateFlags")
                .and_then(|value| value.parse::<u32>().ok())
                .unwrap_or(0);
            if state_flags & 4 == 4 {
                ids.insert(app_id);
            }
        }
    }
    let mut result: Vec<u32> = ids.into_iter().collect();
    result.sort_unstable();
    result
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

pub fn machine_profile() -> MachineProfile {
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
    if let Some(value) = env::var_os("GAMEACCESS_LAUNCHER_DIR") {
        let candidate = PathBuf::from(value);
        if candidate.is_dir() {
            return Some(candidate);
        }
    }
    if let Ok(exe) = env::current_exe() {
        if let Some(dir) = exe.parent() {
            for candidate in [dir.join("launcher"), dir.join("runtime").join("launcher")] {
                if candidate.is_dir() {
                    return Some(candidate);
                }
            }
        }
    }
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    manifest_dir
        .parent()
        .and_then(|desktop| desktop.parent())
        .map(|apps| apps.join("launcher"))
}

pub fn local_steam_pool() -> Result<serde_json::Value, String> {
    read_local_steam_pool()
}

pub fn verify_local_steam_inventory() -> Result<serde_json::Value, String> {
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

pub fn read_local_steam_pool() -> Result<serde_json::Value, String> {
    let launcher =
        launcher_dir().ok_or_else(|| "Could not locate the local Steam adapter".to_string())?;
    let venv_python = launcher.join(".venv").join("Scripts").join("python.exe");
    let python = if venv_python.is_file() {
        venv_python
    } else {
        PathBuf::from("python")
    };
    let code = r#"import json; from pathlib import Path; from steam_pool import scan_pool,steam_root; from steam_appinfo import read_local_app_catalog; p=scan_pool(); ids=set(); [ids.update(a.get('accessible_app_ids') or []) or ids.update(a.get('app_ids') or []) for a in p.get('accounts',[])]; root=steam_root(); ap=(root/'appcache'/'appinfo.vdf') if root else Path('__missing__'); cat=read_local_app_catalog(ap,ids) if ap.is_file() else {}; games=[]; valid=set();
for app_id,item in cat.items():
 t=str(item.get('type') or '').casefold(); n=str(item.get('name') or '').strip(); oslist=str(item.get('oslist') or '').casefold();
 if t=='game' and n and (not oslist or 'windows' in oslist): valid.add(int(app_id)); games.append({'app_id':int(app_id),'name':n,'developer':item.get('developer') or '','publisher':item.get('publisher') or ''})
accounts=[]
for a in p.get('accounts',[]):
 accounts.append({'label':a.get('display_name') or a.get('account_name') or 'Steam','account_name':a.get('account_name') or '','steam_id64':a.get('steam_id64') or '','user_id32':a.get('user_id32'),'app_ids':[x for x in (a.get('app_ids') or []) if x in valid],'accessible_app_ids':[x for x in (a.get('accessible_app_ids') or []) if x in valid],'active':bool(a.get('active'))})
out={'source':'steam-local-remembered-accounts','verification_complete':bool(p.get('ok')),'verified_at':None,'accounts':accounts,'games':sorted(games,key=lambda g:g['app_id']),'library_folders':[]}; print(json.dumps(out,ensure_ascii=False))"#;
    let output = Command::new(&python)
        .current_dir(&launcher)
        .env("PYTHONUTF8", "1")
        .env("PYTHONIOENCODING", "utf-8")
        .args(["-c", code])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map_err(|err| format!("Could not read the remembered personal Steam library: {err}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if stderr.is_empty() {
            "Remembered personal Steam library scan failed".into()
        } else {
            stderr
        });
    }
    serde_json::from_slice(&output.stdout)
        .map_err(|err| format!("Remembered personal Steam library returned invalid data: {err}"))
}

pub fn switch_steam_account(account_label: String) -> SteamAccountSwitchResult {
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

fn steam_media_cache_path(app_id: u32) -> Option<PathBuf> {
    let root = env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(env::temp_dir)
        .join("gameAccess")
        .join("media-cache");
    fs::create_dir_all(&root).ok()?;
    Some(root.join(format!("steam-{app_id}.json")))
}

fn read_steam_media_cache(app_id: u32, max_age_seconds: Option<u64>) -> Option<serde_json::Value> {
    let path = steam_media_cache_path(app_id)?;
    if let Some(max_age) = max_age_seconds {
        let modified = fs::metadata(&path).ok()?.modified().ok()?;
        let age = std::time::SystemTime::now()
            .duration_since(modified)
            .ok()?
            .as_secs();
        if age > max_age {
            return None;
        }
    }
    let bytes = fs::read(path).ok()?;
    serde_json::from_slice(&bytes).ok()
}

fn write_steam_media_cache(app_id: u32, data: &serde_json::Value) {
    let Some(path) = steam_media_cache_path(app_id) else {
        return;
    };
    let Ok(body) = serde_json::to_vec(data) else {
        return;
    };
    let tmp = path.with_extension("json.tmp");
    if fs::write(&tmp, body).is_ok() {
        let _ = fs::rename(tmp, path);
    }
}

pub fn steam_store_metadata(app_id: u32) -> Result<serde_json::Value, String> {
    const CACHE_TTL_SECONDS: u64 = 7 * 24 * 60 * 60;
    if let Some(cached) = read_steam_media_cache(app_id, Some(CACHE_TTL_SECONDS)) {
        return Ok(cached);
    }

    #[cfg(target_os = "windows")]
    {
        let url = format!(
            "https://store.steampowered.com/api/appdetails?appids={app_id}&cc=AR&l=spanish"
        );
        let script = format!("[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; $ProgressPreference='SilentlyContinue'; $headers=@{{'User-Agent'='gameAccess/0.1'}}; $result=Invoke-RestMethod -Uri '{}' -Headers $headers -TimeoutSec 20; $result | ConvertTo-Json -Depth 32 -Compress", url);
        let output = match Command::new("powershell.exe")
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
        {
            Ok(output) => output,
            Err(err) => {
                if let Some(stale) = read_steam_media_cache(app_id, None) {
                    return Ok(stale);
                }
                return Err(format!("Could not query Steam Store metadata: {err}"));
            }
        };
        if !output.status.success() {
            if let Some(stale) = read_steam_media_cache(app_id, None) {
                return Ok(stale);
            }
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
            if let Some(stale) = read_steam_media_cache(app_id, None) {
                return Ok(stale);
            }
            return Err("Steam Store did not return metadata for this AppID".into());
        }
        let data = entry
            .get("data")
            .cloned()
            .ok_or_else(|| "Steam Store response did not contain game data".to_string())?;
        write_steam_media_cache(app_id, &data);
        Ok(data)
    }
    #[cfg(not(target_os = "windows"))]
    {
        read_steam_media_cache(app_id, None).ok_or_else(|| {
            "Steam Store metadata bridge is currently implemented for Windows".into()
        })
    }
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
