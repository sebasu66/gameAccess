use serde::Serialize;
use std::{env, fs, path::PathBuf, process::Command};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

#[derive(Clone, Debug, Default, Serialize)]
pub struct DownloadMetrics {
    pub app_id: u32,
    pub download_total_bytes: Option<u64>,
    pub downloaded_bytes: Option<u64>,
    pub installed_size_bytes: Option<u64>,
    pub estimated_install_size_bytes: Option<u64>,
    pub speed_bps: Option<u64>,
    pub eta_seconds: Option<u64>,
    pub size_source: Option<String>,
    pub size_estimated: bool,
    pub progress_kind: Option<String>,
}

fn quoted_value(text: &str, key: &str) -> Option<String> {
    text.lines().find_map(|line| {
        let parts: Vec<&str> = line.split('"').collect();
        (parts.len() >= 4 && parts[1].eq_ignore_ascii_case(key))
            .then(|| parts[3].replace("\\\\", "\\"))
    })
}

pub fn metrics_from_manifest(app_id: u32, text: &str) -> DownloadMetrics {
    let total = quoted_value(text, "BytesToDownload").and_then(|value| value.parse().ok());
    let downloaded = quoted_value(text, "BytesDownloaded").and_then(|value| value.parse().ok());
    let installed = quoted_value(text, "SizeOnDisk").and_then(|value| value.parse().ok());
    DownloadMetrics {
        app_id,
        download_total_bytes: total,
        downloaded_bytes: downloaded,
        installed_size_bytes: installed,
        estimated_install_size_bytes: None,
        speed_bps: None,
        eta_seconds: None,
        size_source: Some("steam-appmanifest".into()),
        size_estimated: false,
        progress_kind: if total.unwrap_or(0) > 0 { Some("transfer".into()) } else { None },
    }
}

#[cfg(target_os = "windows")]
fn steam_registry_root() -> Option<PathBuf> {
    for (key, value) in [
        ("HKCU\\Software\\Valve\\Steam", "SteamPath"),
        ("HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam", "InstallPath"),
        ("HKLM\\SOFTWARE\\Valve\\Steam", "InstallPath"),
    ] {
        let output = Command::new("reg.exe")
            .args(["query", key, "/v", value])
            .creation_flags(CREATE_NO_WINDOW)
            .output().ok()?;
        if !output.status.success() { continue; }
        for line in String::from_utf8_lossy(&output.stdout).lines() {
            if !line.contains(value) { continue; }
            let candidate = line.split_whitespace().skip(2).collect::<Vec<_>>().join(" ");
            let path = PathBuf::from(candidate.trim());
            if path.is_dir() { return Some(path); }
        }
    }
    None
}

#[cfg(not(target_os = "windows"))]
fn steam_registry_root() -> Option<PathBuf> { None }

fn steam_root() -> Option<PathBuf> {
    steam_registry_root().or_else(|| {
        env::var_os("PROGRAMFILES(X86)")
            .map(PathBuf::from)
            .map(|path| path.join("Steam"))
            .filter(|path| path.is_dir())
    })
}

fn library_roots() -> Vec<PathBuf> {
    let Some(root) = steam_root() else { return Vec::new(); };
    let mut result = vec![root.clone()];
    let folders = root.join("steamapps").join("libraryfolders.vdf");
    if let Ok(text) = fs::read_to_string(folders) {
        for line in text.lines() {
            let parts: Vec<&str> = line.split('"').collect();
            if parts.len() >= 4 && parts[1].eq_ignore_ascii_case("path") {
                let candidate = PathBuf::from(parts[3].replace("\\\\", "\\"));
                if candidate.is_dir() && !result.contains(&candidate) { result.push(candidate); }
            }
        }
    }
    result
}

fn manifest_path(app_id: u32) -> Option<PathBuf> {
    library_roots().into_iter()
        .map(|root| root.join("steamapps").join(format!("appmanifest_{app_id}.acf")))
        .find(|path| path.is_file())
}

pub fn download_metrics(app_id: u32) -> DownloadMetrics {
    manifest_path(app_id)
        .and_then(|path| fs::read_to_string(path).ok())
        .map(|text| metrics_from_manifest(app_id, &text))
        .unwrap_or(DownloadMetrics { app_id, ..Default::default() })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn distinguishes_transfer_bytes_from_installed_size() {
        let metrics = metrics_from_manifest(42, r#"
            "BytesToDownload" "1000"
            "BytesDownloaded" "250"
            "SizeOnDisk" "4000"
        "#);
        assert_eq!(metrics.download_total_bytes, Some(1000));
        assert_eq!(metrics.downloaded_bytes, Some(250));
        assert_eq!(metrics.installed_size_bytes, Some(4000));
        assert_eq!(metrics.progress_kind.as_deref(), Some("transfer"));
    }

    #[test]
    fn zero_pending_transfer_is_not_confused_with_disk_size() {
        let metrics = metrics_from_manifest(7, r#"
            "BytesToDownload" "0"
            "BytesDownloaded" "0"
            "SizeOnDisk" "987654321"
        "#);
        assert_eq!(metrics.download_total_bytes, Some(0));
        assert_eq!(metrics.installed_size_bytes, Some(987654321));
        assert!(metrics.progress_kind.is_none());
    }
}
