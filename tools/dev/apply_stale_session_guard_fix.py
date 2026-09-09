from pathlib import Path

path = Path(__file__).resolve().parents[2] / "apps" / "desktop" / "src-tauri" / "src" / "steam_session.rs"
text = path.read_text(encoding="utf-8")

monitor_marker = '#[cfg(target_os = "windows")]\nfn monitor_game('
helper = '''fn should_clear_stale_session(
    status: &SteamSessionStatus,
    steam_is_running: bool,
    app_is_running: Option<bool>,
) -> bool {
    if status.done || status.phase == "idle" {
        return false;
    }
    matches!(status.phase.as_str(), "launching" | "running")
        && !steam_is_running
        && app_is_running != Some(true)
}

#[cfg(target_os = "windows")]
fn reconcile_runtime_status(status: &mut SteamSessionStatus) {
    let app_is_running = status.app_id.and_then(steam_app_running);
    if should_clear_stale_session(status, steam_running(), app_is_running) {
        status.phase = "aborted".into();
        status.message = "Tracked Steam session ended because Steam and the game are no longer running".into();
        status.done = true;
        status.error = None;
    }
}

#[cfg(target_os = "windows")]
fn monitor_game('''
if monitor_marker not in text:
    raise RuntimeError("monitor_game marker not found")
text = text.replace(monitor_marker, helper, 1)

old_loop = '''    let start_deadline = Instant::now() + Duration::from_secs(180);
    let mut started = false;
    while Instant::now() < start_deadline {
        if steam_app_running(request.app_id) == Some(true) {
            started = true;
            break;
        }
        thread::sleep(Duration::from_secs(1));
    }
'''
new_loop = '''    let start_deadline = Instant::now() + Duration::from_secs(180);
    let mut started = false;
    let mut steam_missing_checks = 0;
    while Instant::now() < start_deadline {
        if steam_app_running(request.app_id) == Some(true) {
            started = true;
            break;
        }
        if steam_running() {
            steam_missing_checks = 0;
        } else {
            steam_missing_checks += 1;
            if steam_missing_checks >= 3 {
                break;
            }
        }
        thread::sleep(Duration::from_secs(1));
    }
'''
if old_loop not in text:
    raise RuntimeError("launch monitor block not found")
text = text.replace(old_loop, new_loop, 1)

old_status = '''#[tauri::command]
pub fn steam_session_status(state: tauri::State<SteamSessionState>) -> SteamSessionStatus {
    state
        .status
        .lock()
        .map(|value| value.clone())
        .unwrap_or_default()
}
'''
new_status = '''#[tauri::command]
pub fn steam_session_status(state: tauri::State<SteamSessionState>) -> SteamSessionStatus {
    state
        .status
        .lock()
        .map(|mut value| {
            #[cfg(target_os = "windows")]
            reconcile_runtime_status(&mut value);
            value.clone()
        })
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::{should_clear_stale_session, SteamSessionStatus};

    fn active(phase: &str) -> SteamSessionStatus {
        SteamSessionStatus {
            phase: phase.into(),
            app_id: Some(1091500),
            account_name: Some("provider".into()),
            message: String::new(),
            done: false,
            error: None,
        }
    }

    #[test]
    fn clears_launching_session_when_steam_and_game_are_gone() {
        assert!(should_clear_stale_session(&active("launching"), false, None));
    }

    #[test]
    fn clears_running_session_when_steam_and_game_are_gone() {
        assert!(should_clear_stale_session(&active("running"), false, Some(false)));
    }

    #[test]
    fn preserves_real_launch_and_restore_transition() {
        assert!(!should_clear_stale_session(&active("launching"), true, Some(false)));
        assert!(!should_clear_stale_session(&active("game-exited"), false, Some(false)));
    }
}
'''
if old_status not in text:
    raise RuntimeError("steam_session_status block not found")
text = text.replace(old_status, new_status, 1)

path.write_text(text, encoding="utf-8", newline="\n")
print("PATCH_OK")
