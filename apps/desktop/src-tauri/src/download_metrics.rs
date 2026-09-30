use serde::Serialize;
use std::{env, fs, path::PathBuf};

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

fn manifest_path(app_id: u32) -> Option<PathBuf> {
    crate::native_core::steam_manifest_path(app_id)
}

fn provider_status_path(app_id: u32) -> Option<PathBuf> {
    if let Some(value) = env::var_os("GAMEACCESS_LAUNCHER_DIR") {
        let root = PathBuf::from(value);
        if root.is_dir() {
            return Some(root.join(".gameaccess").join("downloads").join("status").join(format!("app-{app_id}.json")));
        }
    }
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    manifest_dir.parent()?.parent().map(|apps| {
        apps.join("launcher").join(".gameaccess").join("downloads").join("status").join(format!("app-{app_id}.json"))
    })
}

fn merge_provider_metrics(metrics: &mut DownloadMetrics, app_id: u32) {
    let Some(path) = provider_status_path(app_id) else { return; };
    let Ok(body) = fs::read_to_string(path) else { return; };
    let Ok(value) = serde_json::from_str::<serde_json::Value>(&body) else { return; };

    // Historical provider bytes_total comes from DepotDownloader's
    // "Total bytes on disk". Treat it explicitly as an install-size estimate,
    // never as network-transfer bytes or a basis for network ETA.
    let estimate = value.get("estimated_install_size_bytes").and_then(|v| v.as_u64())
        .or_else(|| value.get("bytes_total").and_then(|v| v.as_u64()));
    if estimate.is_some() && metrics.installed_size_bytes.is_none() {
        metrics.estimated_install_size_bytes = estimate;
        metrics.size_source = Some("provider-depot-disk-estimate".into());
        metrics.size_estimated = true;
    }
    let state = value.get("state").and_then(|v| v.as_str()).unwrap_or("");
    if matches!(state, "requested" | "preparing" | "downloading" | "paused") {
        metrics.progress_kind = Some("disk-estimate".into());
    }
}

pub fn download_metrics(app_id: u32) -> DownloadMetrics {
    let mut metrics = manifest_path(app_id)
        .and_then(|path| fs::read_to_string(path).ok())
        .map(|text| metrics_from_manifest(app_id, &text))
        .unwrap_or(DownloadMetrics { app_id, ..Default::default() });
    merge_provider_metrics(&mut metrics, app_id);
    metrics
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
