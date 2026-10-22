//! Plugin registry. Extracted without changing IPC contracts.

use std::{
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::Mutex,
    time::Duration,
};

#[derive(serde::Serialize, serde::Deserialize, Debug, Clone)]
pub struct PluginManifest {
    pub id: String,
    pub name: String,
    pub endpoint: String,
    #[serde(rename = "type")]
    pub plugin_type: String,
    #[serde(default)]
    pub executable: Option<String>,
    #[serde(default)]
    pub args: Option<Vec<String>>,
    #[serde(default)]
    pub cwd: Option<String>,
    #[serde(default)]
    pub autostart: Option<bool>,
}

static MANAGED_PLUGIN_PROCESSES: Mutex<Vec<Child>> = Mutex::new(Vec::new());

pub struct PluginShutdownGuard;
impl Drop for PluginShutdownGuard {
    fn drop(&mut self) {
        stop_all_plugins();
    }
}

pub fn plugin_shutdown_guard() -> PluginShutdownGuard {
    PluginShutdownGuard
}

pub fn plugin_directories() -> Vec<PathBuf> {
    let mut dirs = Vec::new();

    // 1. Next to the GameAccess executable (plugins folder next to binary)
    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            let next_to_exe = parent.join("plugins");
            if !dirs.contains(&next_to_exe) {
                dirs.push(next_to_exe);
            }
        }
    }

    // 2. Current working directory
    if let Ok(cwd) = std::env::current_dir() {
        let cwd_plugins = cwd.join("plugins");
        if !dirs.contains(&cwd_plugins) {
            dirs.push(cwd_plugins);
        }
        // The example provider and the checkout's plugins are development aids: an installed app only uses
        // the plugins next to it and the ones installed in its data folder.
        let example_provider = cwd.join("examples/source-provider");
        if cfg!(debug_assertions) && !dirs.contains(&example_provider) {
            dirs.push(example_provider);
        }
    }

    let dev_root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../plugins");
    if cfg!(debug_assertions) && !dirs.contains(&dev_root) {
        dirs.push(dev_root);
    }

    // 3. User APPDATA / local share
    let app_data = std::env::var("APPDATA").unwrap_or_else(|_| {
        if cfg!(target_os = "macos") {
            format!("{}/Library/Application Support", std::env::var("HOME").unwrap_or_default())
        } else {
            format!("{}/.local/share", std::env::var("HOME").unwrap_or_default())
        }
    });
    let app_data_plugins = PathBuf::from(app_data).join("GameAccess").join("plugins");
    if !dirs.contains(&app_data_plugins) {
        dirs.push(app_data_plugins);
    }

    dirs
}

pub fn get_registered_plugins_with_paths() -> Vec<(PluginManifest, PathBuf)> {
    let mut results = Vec::new();
    let mut seen_ids = std::collections::HashSet::new();

    for dir in plugin_directories() {
        if !dir.exists() {
            continue;
        }

        // Direct json files in plugins/
        if let Ok(entries) = std::fs::read_dir(&dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_file() && path.extension().map_or(false, |ext| ext == "json") {
                    if let Ok(content) = std::fs::read_to_string(&path) {
                        if let Ok(mut manifest) = serde_json::from_str::<PluginManifest>(&content) {
                            if !seen_ids.contains(&manifest.id) {
                                auto_detect_executable(&mut manifest, &dir);
                                seen_ids.insert(manifest.id.clone());
                                results.push((manifest, dir.clone()));
                            }
                        }
                    }
                } else if path.is_dir() {
                    // Subdirectory (e.g. plugins/torrent-provider/)
                    if let Ok(sub_entries) = std::fs::read_dir(&path) {
                        for sub_entry in sub_entries.flatten() {
                            let sub_path = sub_entry.path();
                            if sub_path.is_file() && sub_path.extension().map_or(false, |ext| ext == "json") {
                                if let Ok(content) = std::fs::read_to_string(&sub_path) {
                                    if let Ok(mut manifest) = serde_json::from_str::<PluginManifest>(&content) {
                                        if !seen_ids.contains(&manifest.id) {
                                            auto_detect_executable(&mut manifest, &path);
                                            seen_ids.insert(manifest.id.clone());
                                            results.push((manifest, path.clone()));
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    results
}

fn auto_detect_executable(manifest: &mut PluginManifest, folder: &Path) {
    if manifest.executable.is_some() {
        return;
    }

    let candidates = [
        "Game Access Torrent Provider.exe",
        "main.exe", "provider.exe", "start.bat", "run.bat", "main.js", "index.js",
    ];
    for candidate in candidates {
        let p = folder.join(candidate);
        if p.is_file() {
            manifest.executable = Some(candidate.to_string());
            break;
        }
    }
}

#[tauri::command]
pub(crate) fn get_registered_plugins() -> Vec<PluginManifest> {
    get_registered_plugins_with_paths()
        .into_iter()
        .map(|(manifest, _)| manifest)
        .collect()
}

pub fn is_endpoint_alive(endpoint: &str) -> bool {
    let health_url = format!("{}/api/health", endpoint.trim_end_matches('/'));
    reqwest::blocking::Client::builder()
        .timeout(Duration::from_millis(400))
        .build()
        .and_then(|client| client.get(&health_url).send())
        .map_or(false, |res| res.status().is_success() || res.status().as_u16() == 404)
}

pub fn start_registered_plugins() {
    let plugins = get_registered_plugins_with_paths();
    for (manifest, folder) in plugins {
        if manifest.autostart == Some(false) {
            continue;
        }

        if is_endpoint_alive(&manifest.endpoint) {
            let _ = crate::activity_log::append_narration_lines(
                vec![format!("Plugin '{}' is already online at {}", manifest.name, manifest.endpoint)],
                "PLUGINS".into(),
                "INFO".into(),
            );
            continue;
        }

        if let Some(ref exec) = manifest.executable {
            let exec_path = folder.join(exec);
            let cwd = manifest.cwd.as_ref()
                .map(|c| folder.join(c))
                .unwrap_or_else(|| folder.clone());

            let args = manifest.args.as_deref().unwrap_or(&[]);
            spawn_plugin_process(&exec_path, args, &cwd, &manifest.name);
        }
    }
}

fn spawn_plugin_process(exec_path: &Path, args: &[String], cwd: &Path, plugin_name: &str) {
    if !exec_path.exists() {
        return;
    }

    let is_bat = exec_path.extension().map_or(false, |ext| ext == "bat" || ext == "cmd");
    let is_js = exec_path.extension().map_or(false, |ext| ext == "js");

    let mut cmd = if is_bat {
        let mut c = Command::new("cmd.exe");
        c.args(["/C", exec_path.to_str().unwrap_or_default()]);
        c.args(args);
        c
    } else if is_js {
        let mut c = Command::new("node");
        c.arg(exec_path);
        c.args(args);
        c
    } else {
        let mut c = Command::new(exec_path);
        c.args(args);
        c
    };

    cmd.current_dir(cwd);
    // Plugins started by Game Access are background services: a plugin that has its own window keeps it closed.
    cmd.env("GAMEACCESS_PLUGIN_HOST", "1");
    cmd.stdin(Stdio::null());
    cmd.stdout(Stdio::null());
    cmd.stderr(Stdio::null());

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    match cmd.spawn() {
        Ok(child) => {
            let pid = child.id();
            let _ = crate::activity_log::append_narration_lines(
                vec![format!("Started plugin '{}' (PID: {})", plugin_name, pid)],
                "PLUGINS".into(),
                "INFO".into(),
            );
            if let Ok(mut list) = MANAGED_PLUGIN_PROCESSES.lock() {
                list.push(child);
            }
        }
        Err(err) => {
            let _ = crate::activity_log::append_narration_lines(
                vec![format!("Failed to start plugin '{}' ({:?}): {}", plugin_name, exec_path, err)],
                "PLUGINS".into(),
                "WARN".into(),
            );
        }
    }
}

pub fn stop_all_plugins() {
    if let Ok(mut processes) = MANAGED_PLUGIN_PROCESSES.lock() {
        for child in processes.iter_mut() {
            let _ = child.kill();
            let _ = child.wait();
        }
        processes.clear();
    }
}
