//! Activity log. Extracted without changing IPC contracts.
use std::env;
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use std::sync::OnceLock;
use std::io::{Read, Seek, SeekFrom, Write};
use crate::launcher_runtime::{find_launcher_dir, launcher_data_dir};

const NARRATION_LOG_MAX_BYTES: u64 = 2 * 1024 * 1024;
const NARRATION_LOG_MAX_LINE_BYTES: usize = 16 * 1024;
pub(crate) static NARRATION_LOG_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

/// In a development checkout the log sits next to the other launcher logs, so it can be
/// read from the project. An installed app has no `apps/desktop` beside its launcher and
/// keeps using the per-user data folder.
fn checkout_log_directory() -> Option<PathBuf> {
    let launcher = find_launcher_dir()?;
    let apps = launcher.parent()?;
    if apps.file_name()? == "apps" && apps.join("desktop").is_dir() {
        Some(launcher.join("logs"))
    } else {
        None
    }
}

pub(crate) fn narration_log_file() -> Result<PathBuf, String> {
    let directory = checkout_log_directory().unwrap_or_else(|| {
        let base = env::var_os("LOCALAPPDATA")
            .map(PathBuf::from)
            .unwrap_or_else(env::temp_dir);
        base.join("GameAccess").join("logs")
    });
    fs::create_dir_all(&directory)
        .map_err(|err| format!("Could not create GameAccess log directory: {err}"))?;
    Ok(directory.join("gameaccess.log"))
}

pub(crate) fn clean_narration_field(value: &str, fallback: &str) -> String {
    let cleaned = value
        .replace(['\r', '\n'], " ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    if cleaned.is_empty() {
        fallback.to_string()
    } else {
        cleaned
    }
}

pub(crate) fn append_narration_lines(
    messages: Vec<String>,
    area: String,
    level: String,
) -> Result<String, String> {
    let _guard = NARRATION_LOG_LOCK
        .get_or_init(|| Mutex::new(()))
        .lock()
        .map_err(|_| "GameAccess narration log lock was poisoned".to_string())?;
    let path = narration_log_file()?;
    let safe_area = clean_narration_field(&area, "APP");
    let safe_level = clean_narration_field(&level, "INFO");
    for message in messages {
        let mut clean = clean_narration_field(&message, "");
        if clean.is_empty() {
            continue;
        }
        if clean.len() > NARRATION_LOG_MAX_LINE_BYTES {
            let mut end = NARRATION_LOG_MAX_LINE_BYTES;
            while !clean.is_char_boundary(end) {
                end -= 1;
            }
            clean.truncate(end);
            clean.push_str("… [truncated]");
        }
        let timestamp = chrono::Local::now().format("%Y-%m-%d %H:%M:%S%.3f");
        let line = format!("{timestamp} [{safe_level}] [{safe_area}] {clean}\n");
        let current_size = fs::metadata(&path).map(|metadata| metadata.len()).unwrap_or(0);
        if current_size.saturating_add(line.len() as u64) > NARRATION_LOG_MAX_BYTES {
            let archive = path.with_extension("log.1");
            if archive.exists() {
                fs::remove_file(&archive)
                    .map_err(|err| format!("Could not rotate old GameAccess log: {err}"))?;
            }
            if path.exists() {
                fs::rename(&path, &archive)
                    .map_err(|err| format!("Could not rotate GameAccess narration log: {err}"))?;
                if fs::metadata(&archive)
                    .map(|metadata| metadata.len())
                    .unwrap_or(0)
                    > NARRATION_LOG_MAX_BYTES
                {
                    fs::remove_file(&archive)
                        .map_err(|err| format!("Could not cap oversized archived GameAccess log: {err}"))?;
                }
            }
        }
        let mut file = fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&path)
            .map_err(|err| format!("Could not open GameAccess narration log: {err}"))?;
        file.write_all(line.as_bytes())
            .map_err(|err| format!("Could not append GameAccess narration log: {err}"))?;
        file.flush()
            .map_err(|err| format!("Could not flush GameAccess narration log: {err}"))?;
    }
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
pub(crate) fn narration_log_path() -> Result<String, String> {
    Ok(narration_log_file()?.to_string_lossy().to_string())
}

#[tauri::command]
pub(crate) fn append_narration_log(message: String, area: String, level: String) -> Result<String, String> {
    append_narration_lines(vec![message], area, level)
}

#[tauri::command]
pub(crate) fn append_narration_log_batch(
    messages: Vec<String>,
    area: String,
    level: String,
) -> Result<String, String> {
    append_narration_lines(messages, area, level)
}

pub(crate) fn read_log_tail(path: PathBuf, area: &str) -> Vec<String> {
    let Ok(mut file) = fs::File::open(path) else { return Vec::new() };
    let Ok(size) = file.metadata().map(|m| m.len()) else { return Vec::new() };
    let offset = size.saturating_sub(64 * 1024);
    if file.seek(SeekFrom::Start(offset)).is_err() { return Vec::new() }
    let mut bytes = Vec::new();
    if file.read_to_end(&mut bytes).is_err() { return Vec::new() }
    String::from_utf8_lossy(&bytes).lines().skip(if offset > 0 {1} else {0}).map(|s| format!("[{area}] {s}")).collect()
}
#[tauri::command]
pub(crate) fn read_activity_console() -> Result<Vec<String>, String> {
    let mut lines = read_log_tail(narration_log_file()?, "APP");
    if let Some(launcher) = find_launcher_dir() {
        for (name, area) in [("downloads.log", "DOWNLOAD"), ("execution.log", "EXECUTION")] {
            lines.extend(read_log_tail(launcher_data_dir(&launcher).join("logs").join(name), area));
        }
    }
    lines.sort_by_key(|line| line.split("] ").nth(1).unwrap_or("").chars().take(19).collect::<String>());
    Ok(lines)
}
