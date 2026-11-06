//! The controller's Xbox (Guide) button for Game Access instead of Steam (Seba, 2026-11-04).
//!
//! Steam opens Big Picture when the Guide button is pressed. It reads the button through the SDL mappings it keeps in
//! `<Steam>\config\config.vdf` ("SDL_GamepadBind": one line per controller set up in Steam, with `guide:bN`). Taking
//! `guide:bN` out of those lines makes Steam ignore the button for those controllers (documented by players in
//! https://gist.github.com/rosswd/c0c8b46d1ae5bb4f02207b6195392f93). Steam rewrites config.vdf when it exits, so the
//! file is only changed while Steam is closed, and the original is kept next to it for "restore".
//! A controller Steam knows from its own database has no line there: for it Steam's setting "Guide Button Focuses
//! Steam" (Settings › Controller) is the way, which the interface explains.
//!
//! Game Access reads the button itself with XInputGetStateEx (xinput1_4 ordinal 100: XInputGetState does not report
//! it). Reading does not take the button from other programs. A press brings Game Access to the front and tells the
//! interface (`gameaccess:guide-button`), which opens big picture mode.
//!
//! The mapping lines cannot always be changed (Steam open, usually from Windows' start; a controller without a line), so
//! the file is not enough: Steam may still open its Big Picture over ours. When that window shows up after a press it is
//! closed with Steam's own link, `steam://close/bigpicture`, and Game Access comes back to the front. While a Steam game
//! is running the button is left alone: it belongs to the game.

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};

const BACKUP_NAME: &str = "config.vdf.gameaccess-guide.bak";
static LISTENING: AtomicBool = AtomicBool::new(false);
static STARTED: AtomicBool = AtomicBool::new(false);
static WATCHING: AtomicBool = AtomicBool::new(false);

/// Removes every `guide:bN` entry from the SDL mapping lines; returns the new text and how many it removed.
pub(crate) fn strip_guide(text: &str) -> (String, usize) {
    let mut out = String::with_capacity(text.len());
    let mut removed = 0;
    let mut rest = text;
    while let Some(at) = rest.find("guide:b") {
        let after = &rest[at + 7..];
        let digits = after.chars().take_while(|c| c.is_ascii_digit()).count();
        // Only a whole entry: preceded by a comma, then digits, then a comma (the mapping's own separators).
        let whole = digits > 0 && at > 0 && rest.as_bytes()[at - 1] == b',' && after.as_bytes().get(digits) == Some(&b',');
        if whole {
            out.push_str(&rest[..at]);
            rest = &after[digits + 1..];
            removed += 1;
        } else {
            out.push_str(&rest[..at + 7]);
            rest = after;
        }
    }
    out.push_str(rest);
    (out, removed)
}

fn steam_config() -> Option<PathBuf> {
    gameaccess_desktop::native_core::runtime_prerequisites().steam_path.map(|root| PathBuf::from(root).join("config").join("config.vdf")).filter(|path| path.is_file())
}

#[cfg(windows)]
fn steam_running() -> bool {
    crate::game_focus::process_images().iter().any(|process| process.image.to_lowercase().ends_with("\\steam.exe"))
}
#[cfg(not(windows))]
fn steam_running() -> bool { false }

fn count_bound(text: &str) -> usize { strip_guide(text).1 }

/// {found, steam_running, bound: Guide entries Steam still has, released: Game Access took them out (backup kept)}.
#[tauri::command]
pub async fn steam_guide_state() -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let Some(config) = steam_config() else { return Ok(serde_json::json!({ "found": false })) };
        let text = std::fs::read_to_string(&config).map_err(|e| e.to_string())?;
        Ok(serde_json::json!({ "found": true, "steam_running": steam_running(), "bound": count_bound(&text), "released": config.with_file_name(BACKUP_NAME).is_file() }))
    }).await.map_err(|e| e.to_string())?
}

/// Takes the Guide button away from Steam. Errors: "not_found", "steam_running" (Steam would write the file back).
#[tauri::command]
pub async fn steam_guide_release() -> Result<usize, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let config = steam_config().ok_or("not_found")?;
        if steam_running() { return Err("steam_running".into()); }
        let text = std::fs::read_to_string(&config).map_err(|e| e.to_string())?;
        let (stripped, removed) = strip_guide(&text);
        if removed == 0 { return Ok(0); }
        let backup = config.with_file_name(BACKUP_NAME);
        // The first original is the one to go back to: a later release keeps it.
        if !backup.is_file() { std::fs::copy(&config, &backup).map_err(|e| e.to_string())?; }
        let temporary = config.with_extension("vdf.gameaccess-tmp");
        std::fs::write(&temporary, stripped).map_err(|e| e.to_string())?;
        std::fs::rename(&temporary, &config).map_err(|e| e.to_string())?;
        crate::activity_log::append_narration_lines(vec![format!("Steam: took {removed} Guide-button mapping(s) out of config.vdf (backup {BACKUP_NAME}).")], "STEAM".into(), "INFO".into()).ok();
        Ok(removed)
    }).await.map_err(|e| e.to_string())?
}

/// Gives the Guide button back to Steam: the kept original returns. Errors: "not_found", "steam_running", "no_backup".
#[tauri::command]
pub async fn steam_guide_restore() -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(|| {
        let config = steam_config().ok_or("not_found")?;
        if steam_running() { return Err("steam_running".into()); }
        let backup = config.with_file_name(BACKUP_NAME);
        if !backup.is_file() { return Err("no_backup".into()); }
        // Only the mapping lines come back: whatever Steam saved since then (other settings) stays.
        let original = std::fs::read_to_string(&backup).map_err(|e| e.to_string())?;
        let now = std::fs::read_to_string(&config).map_err(|e| e.to_string())?;
        let restored = match (mapping_value(&original), mapping_value(&now)) {
            (Some(old), Some(current)) => now.replacen(current, old, 1),
            _ => original,
        };
        std::fs::write(&config, restored).map_err(|e| e.to_string())?;
        std::fs::remove_file(&backup).map_err(|e| e.to_string())?;
        crate::activity_log::append_narration_lines(vec!["Steam: Guide-button mappings restored in config.vdf.".to_string()], "STEAM".into(), "INFO".into()).ok();
        Ok(())
    }).await.map_err(|e| e.to_string())?
}

/// The quoted value of "SDL_GamepadBind" (it spans several lines).
fn mapping_value(text: &str) -> Option<&str> {
    let key = text.find("\"SDL_GamepadBind\"")?;
    let open = key + 17 + text[key + 17..].find('"')? + 1;
    let close = open + text[open..].find('"')?;
    Some(&text[open..close])
}

/// Steam's Big Picture window, by its title ("Steam Big Picture Mode", "Modo Big Picture de Steam"): Windows' title can
/// carry a non-breaking space between the words.
fn is_big_picture_title(title: &str) -> bool {
    title.to_lowercase().replace('\u{a0}', " ").contains("big picture")
}

/// A running game's id in `reg query` output: the last word of the RunningAppID line, in hexadecimal; 0 is no game.
fn running_app(output: &str) -> bool {
    output.lines().find(|line| line.contains("RunningAppID")).and_then(|line| line.split_whitespace().last()).and_then(|value| u32::from_str_radix(value.trim_start_matches("0x"), 16).ok()).is_some_and(|id| id != 0)
}

#[cfg(windows)]
fn steam_game_running() -> bool {
    use std::os::windows::process::CommandExt;
    std::process::Command::new("reg.exe").args(["query", r"HKCU\Software\Valve\Steam\ActiveProcess", "/v", "RunningAppID"]).creation_flags(0x0800_0000).output().is_ok_and(|output| running_app(&String::from_utf8_lossy(&output.stdout)))
}

/// For a few seconds after a press: if Steam's Big Picture appears, closes it and puts Game Access back in front.
#[cfg(windows)]
fn close_steam_big_picture(app: tauri::AppHandle) {
    use std::os::windows::process::CommandExt;
    use tauri::Manager;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    if WATCHING.swap(true, Ordering::SeqCst) { return; }
    std::thread::spawn(move || {
        for _ in 0..24 {
            std::thread::sleep(std::time::Duration::from_millis(250));
            if !crate::game_focus::window_titles("\\steamwebhelper.exe").iter().any(|title| is_big_picture_title(title)) { continue; }
            let closed = std::process::Command::new("explorer.exe").arg("steam://close/bigpicture").creation_flags(CREATE_NO_WINDOW).spawn().is_ok();
            std::thread::sleep(std::time::Duration::from_millis(1500));
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                if let Ok(handle) = window.hwnd() { crate::game_focus::force_foreground(handle.0 as isize); }
            }
            crate::activity_log::append_narration_lines(vec![format!("Steam: Big Picture opened with the Guide button; closed: {closed}.")], "STEAM".into(), "INFO".into()).ok();
            break;
        }
        WATCHING.store(false, Ordering::SeqCst);
    });
}

/// Turns Game Access's own reading of the Guide button on or off (the player's setting).
#[tauri::command]
pub fn steam_guide_listen(app: tauri::AppHandle, on: bool) {
    LISTENING.store(on, Ordering::SeqCst);
    if on && !STARTED.swap(true, Ordering::SeqCst) { start_listener(app); }
}

#[cfg(windows)]
mod xinput {
    #[repr(C)]
    #[derive(Default)]
    pub struct Gamepad { pub buttons: u16, left_trigger: u8, right_trigger: u8, thumb_lx: i16, thumb_ly: i16, thumb_rx: i16, thumb_ry: i16 }
    #[repr(C)]
    #[derive(Default)]
    pub struct State { packet_number: u32, pub gamepad: Gamepad }
    pub const GUIDE: u16 = 0x0400;
    #[link(name = "xinput1_4", kind = "raw-dylib")]
    extern "system" {
        #[link_ordinal(100)]
        pub fn XInputGetStateEx(user_index: u32, state: *mut State) -> u32;
    }
}

#[cfg(windows)]
fn start_listener(app: tauri::AppHandle) {
    use tauri::{Emitter, Manager};
    std::thread::spawn(move || {
        let mut held = [false; 4];
        loop {
            std::thread::sleep(std::time::Duration::from_millis(if LISTENING.load(Ordering::SeqCst) { 60 } else { 500 }));
            if !LISTENING.load(Ordering::SeqCst) { held = [false; 4]; continue; }
            for slot in 0..4u32 {
                let mut state = xinput::State::default();
                let pressed = unsafe { xinput::XInputGetStateEx(slot, &mut state) } == 0 && state.gamepad.buttons & xinput::GUIDE != 0;
                if pressed && !held[slot as usize] && !steam_game_running() {
                    close_steam_big_picture(app.clone());
                    if let Some(window) = app.get_webview_window("main") { let _ = window.unminimize(); let _ = window.show(); let _ = window.set_focus(); }
                    crate::webview_rest::wake(&app);
                    let _ = app.emit_to("main", "gameaccess:guide-button", ());
                }
                held[slot as usize] = pressed;
            }
        }
    });
}
#[cfg(not(windows))]
fn start_listener(_app: tauri::AppHandle) {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn takes_out_only_whole_guide_entries() {
        let text = "\"SDL_GamepadBind\"\t\t\"03000000,Xbox 360 Controller,a:b0,back:b4,guide:b5,start:b6,\n0300,Pad,guide:b10,x:b2,\"\n\"guide:b9\"";
        let (stripped, removed) = strip_guide(text);
        assert_eq!(removed, 2);
        assert!(stripped.contains("back:b4,start:b6,") && stripped.contains("Pad,x:b2,") && stripped.ends_with("\"guide:b9\""));
        assert_eq!(strip_guide(&stripped).1, 0);
    }

    #[test]
    fn reads_the_running_game() {
        assert!(running_app("    RunningAppID    REG_DWORD    0x1234"));
        assert!(!running_app("    RunningAppID    REG_DWORD    0x0"));
        assert!(!running_app(""));
    }

    #[test]
    fn knows_the_big_picture_window_by_its_title() {
        assert!(is_big_picture_title("Modo Big\u{a0}Picture de Steam"));
        assert!(is_big_picture_title("Steam Big Picture Mode"));
        assert!(!is_big_picture_title("Steam"));
    }

    #[test]
    fn finds_the_mapping_value() {
        let text = "x\n\t\"SDL_GamepadBind\"\t\t\"a,b,guide:b5,\nc,d,\"\n}";
        assert_eq!(mapping_value(text), Some("a,b,guide:b5,\nc,d,"));
    }
}
