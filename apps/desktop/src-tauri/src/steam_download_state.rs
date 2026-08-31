use std::time::{Duration, Instant};

pub const INSTALL_REQUEST_GRACE: Duration = Duration::from_secs(120);

const STATE_DOWNLOAD_REQUIRED_OR_RUNNING: u32 = 2;
const STATE_FULLY_INSTALLED: u32 = 4;
const STATE_DOWNLOAD_COMPLETED: u32 = 64;
const STATE_DOWNLOAD_PAUSED: u32 = 512;
const STATE_DLC_DOWNLOAD: u32 = 1024;

pub struct ManifestDownloadState {
    pub state: &'static str,
    pub installed: bool,
    pub progress: Option<f64>,
}

pub fn request_is_recent(requested_at: Instant, now: Instant) -> bool {
    now.checked_duration_since(requested_at)
        .is_some_and(|age| age < INSTALL_REQUEST_GRACE)
}

pub fn state_without_manifest(recently_requested: bool) -> &'static str {
    if recently_requested {
        "requested"
    } else {
        "not-installed"
    }
}

pub fn classify_manifest_state(
    state_flags: u32,
    bytes_downloaded: Option<u64>,
    bytes_total: Option<u64>,
    download_dir_exists: bool,
    install_dir_exists: bool,
) -> ManifestDownloadState {
    let pending_bytes = matches!(
        (bytes_downloaded, bytes_total),
        (Some(done), Some(total)) if total > 0 && done < total
    );
    let download_flag = state_flags & STATE_DOWNLOAD_REQUIRED_OR_RUNNING != 0
        || state_flags & STATE_DLC_DOWNLOAD != 0;
    let completed = state_flags & STATE_DOWNLOAD_COMPLETED != 0;
    let paused = state_flags & STATE_DOWNLOAD_PAUSED != 0;
    let update_pending = download_flag && !completed;
    let downloading = update_pending || (download_dir_exists && pending_bytes && !completed && !paused);
    let installed = !downloading
        && !pending_bytes
        && state_flags & STATE_FULLY_INSTALLED != 0
        && install_dir_exists;
    let progress = match (bytes_downloaded, bytes_total) {
        (Some(done), Some(total)) if total > 0 => {
            Some(((done as f64 / total as f64) * 100.0).clamp(0.0, 100.0))
        }
        _ if installed => Some(100.0),
        _ => None,
    };
    let state = if downloading {
        "downloading"
    } else if installed {
        "installed"
    } else {
        "preparing"
    };
    ManifestDownloadState {
        state,
        installed,
        progress,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_a_new_install_request_alive_until_steam_creates_the_manifest() {
        let now = Instant::now();
        assert!(request_is_recent(now - Duration::from_secs(30), now));
        assert_eq!(state_without_manifest(true), "requested");
        assert!(!request_is_recent(now - Duration::from_secs(121), now));
        assert_eq!(state_without_manifest(false), "not-installed");
    }

    #[test]
    fn recognizes_a_fully_installed_game_only_when_its_install_directory_exists() {
        let ready = classify_manifest_state(4, None, None, false, true);
        assert!(ready.installed);
        assert_eq!(ready.state, "installed");
        assert_eq!(ready.progress, Some(100.0));

        let missing_files = classify_manifest_state(4, None, None, false, false);
        assert!(!missing_files.installed);
        assert_eq!(missing_files.state, "preparing");
    }

    #[test]
    fn recognizes_update_required_and_dlc_download_flags() {
        let update = classify_manifest_state(6, Some(0), Some(100), true, true);
        assert!(!update.installed);
        assert_eq!(update.state, "downloading");

        let dlc = classify_manifest_state(1030, None, None, false, true);
        assert!(!dlc.installed);
        assert_eq!(dlc.state, "downloading");
    }

    #[test]
    fn completed_download_flag_overrides_download_signal() {
        let completed = classify_manifest_state(70, None, None, true, true);
        assert!(completed.installed);
        assert_eq!(completed.state, "installed");
    }

    #[test]
    fn residual_download_directory_alone_does_not_hide_a_ready_game() {
        let ready = classify_manifest_state(4, None, None, true, true);
        assert!(ready.installed);
        assert_eq!(ready.state, "installed");
    }

    #[test]
    fn pending_bytes_are_a_fallback_when_the_manifest_flags_lag() {
        let bytes = classify_manifest_state(0, Some(25), Some(100), true, false);
        assert_eq!(bytes.state, "downloading");
        assert_eq!(bytes.progress, Some(25.0));
    }
}
