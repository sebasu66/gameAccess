//! Launcher runtime. Extracted without changing IPC contracts.
use std::env;
use std::path::{Path, PathBuf};

const LAUNCHER_DATA_VAR: &str = "GAMEACCESS_LAUNCHER_DATA";

/// Where the launcher keeps its state (`.cache`, `logs`). A development checkout keeps it inside
/// `apps/launcher`. An installed app may live in Program Files, which a normal user cannot write, so
/// `configure_launcher_data` points every launcher process at `%LOCALAPPDATA%\gameAccess\launcher`
/// (the Python side reads the same variable in `launcher_data.py`).
pub(crate) fn launcher_data_dir(launcher: &Path) -> PathBuf {
    env::var_os(LAUNCHER_DATA_VAR).map(PathBuf::from).unwrap_or_else(|| launcher.to_path_buf())
}

/// Call first thing in `main`, before any thread starts: child processes inherit the variable.
pub(crate) fn configure_launcher_data() {
    if env::var_os(LAUNCHER_DATA_VAR).is_some() { return; }
    let installed = find_launcher_dir().and_then(|launcher| launcher.parent().and_then(|parent| parent.file_name()).map(|name| name == "runtime")).unwrap_or(false);
    if !installed { return; }
    let Some(base) = env::var_os("LOCALAPPDATA") else { return };
    let data = PathBuf::from(base).join("gameAccess").join("launcher");
    if std::fs::create_dir_all(&data).is_ok() { env::set_var(LAUNCHER_DATA_VAR, &data); }
}

pub(crate) fn find_launcher_python(launcher: &std::path::Path) -> PathBuf {
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

pub(crate) fn launcher_below(root: &std::path::Path) -> Option<PathBuf> {
    ["runtime/launcher", "apps/launcher", "launcher"].iter()
        .map(|relative| root.join(relative))
        .find(|path| path.join("digital_downloader.py").is_file())
}

pub(crate) fn find_launcher_dir() -> Option<PathBuf> {
    if let Ok(path) = env::var("GAMEACCESS_LAUNCHER_DIR") {
        let candidate = PathBuf::from(path);
        if candidate.is_dir() {
            return Some(candidate);
        }
    }
    if let Ok(exe) = env::current_exe() {
        for ancestor in exe.ancestors() {
            if let Some(candidate) = launcher_below(ancestor) { return Some(candidate); }
        }
    }
    env::current_dir().ok().and_then(|cwd| {
        for ancestor in cwd.ancestors() {
            if let Some(candidate) = launcher_below(ancestor) { return Some(candidate); }
        }
        None
    })
}
