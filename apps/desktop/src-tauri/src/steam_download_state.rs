use std::time::{Duration, Instant};

pub const INSTALL_REQUEST_GRACE: Duration = Duration::from_secs(120);

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
    let installed = state_flags & 4 == 4 && install_dir_exists;
    let pending_bytes = matches!(
        (bytes_downloaded, bytes_total),
        (Some(done), Some(total)) if total > 0 && done < total
    );
    let progress = match (bytes_downloaded, bytes_total) {
        (Some(done), Some(total)) if total > 0 => {
            Some(((done as f64 / total as f64) * 100.0).clamp(0.0, 100.0))
        }
        _ if installed => Some(100.0),
        _ => None,
    };
    let state = if installed {
        "installed"
    } else if download_dir_exists || pending_bytes {
        "downloading"
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
    fn recognizes_active_downloads_from_bytes_or_the_downloading_directory() {
        let bytes = classify_manifest_state(0, Some(25), Some(100), false, false);
        assert_eq!(bytes.state, "downloading");
        assert_eq!(bytes.progress, Some(25.0));

        let directory = classify_manifest_state(0, None, None, true, false);
        assert_eq!(directory.state, "downloading");
        assert_eq!(directory.progress, None);
    }
}
