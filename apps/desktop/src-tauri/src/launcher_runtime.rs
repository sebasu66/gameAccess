//! Launcher runtime. Extracted without changing IPC contracts.
use std::env;
use std::path::PathBuf;

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
