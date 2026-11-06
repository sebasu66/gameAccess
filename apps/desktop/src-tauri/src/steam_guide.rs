//! The controller's Xbox (Guide) button for Game Access instead of Steam (Seba, 2026-11-04).
//!
//! Steam opens Big Picture when the Guide button is pressed. What stops it is Steam's own setting "Guide Button Focuses
//! Steam" (Settings › Controller › Advanced): `"Controller_CheckGuideButton" "0"` at the top of each account's
//! `userdata\<id>\config\localconfig.vdf`, seen by turning it off in Steam (2026-11-06; on by default, so the key is
//! missing until then). Steam keeps it in memory and writes the file itself, so the file is only changed while Steam is
//! closed: `steam_guide_restart` closes it, writes and starts it again. FOCUS_MARK lists the accounts changed here, for
//! "restore"; while it exists, the launcher's account switch does the same (steam_account_manager/switch.py).
//! The SDL mappings in `config.vdf` ("SDL_GamepadBind", with `guide:bN`) also come out, as players do it
//! (https://gist.github.com/rosswd/c0c8b46d1ae5bb4f02207b6195392f93), with the original kept next to the file.
//!
//! Game Access reads the button itself with XInputGetStateEx (xinput1_4 ordinal 100: XInputGetState does not report
//! it). Reading does not take the button from other programs. A press brings Game Access to the front and tells the
//! interface (`gameaccess:guide-button`), which opens big picture mode.
//!
//! With Game Access closed the button still opens it: `--guide-watch` is this same program without a window, started at
//! sign-in (HKCU Run, RUN_VALUE) only to read the button; a press starts the app with `--big-picture`. It sees the
//! choice is gone (the Run value) on the next press and leaves; the installer stops it before replacing the program.
//!
//! Until Steam has been restarted once, or on an account signing in for the first time, Steam may still open its Big
//! Picture over ours. When that window shows up after a press it is closed with Steam's own link,
//! `steam://close/bigpicture`, and Game Access comes back to the front. While a game is running the button is left
//! alone: it belongs to the game.

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};

const BACKUP_NAME: &str = "config.vdf.gameaccess-guide.bak";
const FOCUS_KEY: &str = "\"Controller_CheckGuideButton\"";
const FOCUS_MARK: &str = "gameaccess-guide-focus.off";
static LISTENING: AtomicBool = AtomicBool::new(false);
static STARTED: AtomicBool = AtomicBool::new(false);
static WATCHING: AtomicBool = AtomicBool::new(false);
static OPENED_BY_BUTTON: AtomicBool = AtomicBool::new(false);
const RUN_KEY: &str = r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run";
const RUN_VALUE: &str = "GameAccessGuideButton";

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

/// `localconfig.vdf` with Steam's Guide setting off; None when it already is, or the text is not that file.
pub(crate) fn focus_off(text: &str) -> Option<String> {
    if !text.trim_start().starts_with("\"UserLocalConfigStore\"") { return None; }
    if let Some(at) = top_level_key(text) {
        let line = text[at..].lines().next().unwrap_or("");
        return (!line.ends_with("\"0\"")).then(|| format!("{}{FOCUS_KEY}\t\t\"0\"{}", &text[..at], &text[at + line.len()..]));
    }
    let close = text.rfind('}')?;
    Some(format!("{}\t{FOCUS_KEY}\t\t\"0\"\n{}", &text[..close], &text[close..]))
}

/// The same file back on Steam's default: without the key.
pub(crate) fn focus_default(text: &str) -> Option<String> {
    let at = top_level_key(text)?;
    let start = text[..at].rfind('\n').map_or(0, |line| line + 1);
    let end = text[at..].find('\n').map_or(text.len(), |line| at + line + 1);
    Some(format!("{}{}", &text[..start], &text[end..]))
}

/// Where the key is, only at the top level of the file (one tab in).
fn top_level_key(text: &str) -> Option<usize> {
    text.match_indices(FOCUS_KEY).map(|(at, _)| at).find(|&at| text[..at].rsplit('\n').next() == Some("\t"))
}

fn local_configs(root: &std::path::Path) -> Vec<(String, PathBuf)> {
    let Ok(folders) = std::fs::read_dir(root.join("userdata")) else { return Vec::new() };
    folders.flatten().map(|folder| (folder.file_name().to_string_lossy().into_owned(), folder.path().join("config").join("localconfig.vdf"))).filter(|(_, path)| path.is_file()).collect()
}

fn focus_pending(root: &std::path::Path) -> usize {
    local_configs(root).iter().filter(|(_, path)| std::fs::read_to_string(path).is_ok_and(|text| focus_off(&text).is_some())).count()
}

fn steam_root(config: &std::path::Path) -> Option<PathBuf> { config.parent()?.parent().map(PathBuf::from) }

fn replace_file(path: &std::path::Path, text: String) -> Result<(), String> {
    let temporary = path.with_extension("vdf.gameaccess-tmp");
    std::fs::write(&temporary, text).map_err(|e| e.to_string())?;
    std::fs::rename(&temporary, path).map_err(|e| e.to_string())
}

/// Steam closed: the setting off in every account here. The mark stays even when nothing changed: it says the choice is on.
fn release_focus(config: &std::path::Path) -> Result<usize, String> {
    let mark = config.with_file_name(FOCUS_MARK);
    let mut changed: Vec<String> = std::fs::read_to_string(&mark).unwrap_or_default().lines().map(String::from).collect();
    let before = changed.len();
    for (account, path) in local_configs(&steam_root(config).ok_or("not_found")?) {
        let Some(next) = std::fs::read_to_string(&path).ok().and_then(|text| focus_off(&text)) else { continue };
        replace_file(&path, next)?;
        if !changed.contains(&account) { changed.push(account); }
    }
    std::fs::write(&mark, changed.join("\n")).map_err(|e| e.to_string())?;
    Ok(changed.len() - before)
}

/// Steam closed: the accounts changed here go back; one that had it off by itself stays as it was.
fn restore_focus(config: &std::path::Path) -> Result<(), String> {
    let mark = config.with_file_name(FOCUS_MARK);
    let root = steam_root(config).ok_or("not_found")?;
    for account in std::fs::read_to_string(&mark).unwrap_or_default().lines() {
        let path = root.join("userdata").join(account).join("config").join("localconfig.vdf");
        if let Some(next) = std::fs::read_to_string(&path).ok().and_then(|text| focus_default(&text)) { replace_file(&path, next)?; }
    }
    if mark.is_file() { std::fs::remove_file(&mark).map_err(|e| e.to_string())?; }
    Ok(())
}

/// Steam closed: the setting off everywhere and the SDL mappings out; how many of those it removed.
fn release_all(config: &std::path::Path) -> Result<usize, String> {
    let accounts = release_focus(config)?;
    let text = std::fs::read_to_string(config).map_err(|e| e.to_string())?;
    let (stripped, removed) = strip_guide(&text);
    if removed > 0 {
        let backup = config.with_file_name(BACKUP_NAME);
        // The first original is the one to go back to: a later release keeps it.
        if !backup.is_file() { std::fs::copy(config, &backup).map_err(|e| e.to_string())?; }
        replace_file(config, stripped)?;
    }
    crate::activity_log::append_narration_lines(vec![format!("Steam: Guide button off in {accounts} account(s), {removed} mapping(s) out of config.vdf.")], "STEAM".into(), "INFO".into()).ok();
    Ok(removed)
}

/// {found, steam_running, bound: Guide entries Steam still has, focus_pending: accounts where Steam still reacts to the
/// button, released: Game Access changed something (backup or mark kept)}.
#[tauri::command]
pub async fn steam_guide_state() -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let Some(config) = steam_config() else { return Ok(serde_json::json!({ "found": false })) };
        let text = std::fs::read_to_string(&config).map_err(|e| e.to_string())?;
        let root = steam_root(&config).ok_or("not_found")?;
        let released = config.with_file_name(BACKUP_NAME).is_file() || config.with_file_name(FOCUS_MARK).is_file();
        Ok(serde_json::json!({ "found": true, "steam_running": steam_running(), "bound": count_bound(&text), "focus_pending": focus_pending(&root), "released": released }))
    }).await.map_err(|e| e.to_string())?
}

/// Takes the Guide button away from Steam. Errors: "not_found", "steam_running" (Steam would write the file back).
#[tauri::command]
pub async fn steam_guide_release() -> Result<usize, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let config = steam_config().ok_or("not_found")?;
        if steam_running() {
            // An open Steam overwrites the files; with every account already off only the choice is left to note.
            if focus_pending(&steam_root(&config).ok_or("not_found")?) > 0 { return Err("steam_running".into()); }
            if !config.with_file_name(FOCUS_MARK).is_file() { std::fs::write(config.with_file_name(FOCUS_MARK), "").map_err(|e| e.to_string())?; }
            return Ok(0);
        }
        release_all(&config)
    }).await.map_err(|e| e.to_string())?
}

/// Closes Steam, turns its Guide button off and starts it again (minimised). Errors: "not_found", "game_running",
/// "steam_slow" (it did not close in time).
#[tauri::command]
pub async fn steam_guide_restart() -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(|| {
        let config = steam_config().ok_or("not_found")?;
        if crate::webview_rest::game_running() || steam_game_running() { return Err("game_running".into()); }
        let steam = steam_root(&config).ok_or("not_found")?.join("steam.exe");
        if steam_running() {
            std::process::Command::new(&steam).arg("-shutdown").spawn().map_err(|e| e.to_string())?;
            let mut waited = 0;
            while steam_running() {
                if waited >= 160 { return Err("steam_slow".into()); }
                std::thread::sleep(std::time::Duration::from_millis(250));
                waited += 1;
            }
        }
        let released = release_all(&config);
        std::process::Command::new(&steam).arg("-silent").spawn().map_err(|e| e.to_string())?;
        released.map(|_| ())
    }).await.map_err(|e| e.to_string())?
}

/// Gives the Guide button back to Steam: the kept original returns. Errors: "not_found", "steam_running", "no_backup".
#[tauri::command]
pub async fn steam_guide_restore() -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(|| {
        let config = steam_config().ok_or("not_found")?;
        if steam_running() { return Err("steam_running".into()); }
        let mark = config.with_file_name(FOCUS_MARK).is_file();
        restore_focus(&config)?;
        let backup = config.with_file_name(BACKUP_NAME);
        if !backup.is_file() { return if mark { Ok(()) } else { Err("no_backup".into()) }; }
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

#[cfg(not(windows))]
fn steam_game_running() -> bool { false }

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

/// Turns Game Access's own reading of the Guide button on or off (the player's setting). `closed`: also with the app closed.
#[tauri::command]
pub fn steam_guide_listen(app: tauri::AppHandle, on: bool, closed: Option<bool>) {
    LISTENING.store(on, Ordering::SeqCst);
    if on && !STARTED.swap(true, Ordering::SeqCst) { start_listener(app); }
    if !cfg!(debug_assertions) { set_resident(on && closed.unwrap_or(true)); }
}

/// What the installer chose (`HKLM\Software\gameAccess\GuideRedirect`): on unless it is "0".
#[tauri::command]
pub fn steam_guide_default() -> bool { installer_value().as_deref() != Some("0") }

/// True once when the button is what started the app: it opens in big picture mode.
#[tauri::command]
pub fn steam_guide_opened_by_button() -> bool { OPENED_BY_BUTTON.swap(false, Ordering::SeqCst) }

#[cfg(windows)]
fn quiet_reg(args: &[&str]) -> Option<std::process::Output> {
    use std::os::windows::process::CommandExt;
    std::process::Command::new("reg.exe").args(args).creation_flags(0x0800_0000).output().ok()
}

#[cfg(windows)]
fn installer_value() -> Option<String> {
    let output = quiet_reg(&["query", r"HKLM\Software\gameAccess", "/v", "GuideRedirect", "/reg:64"])?;
    String::from_utf8_lossy(&output.stdout).lines().find(|line| line.trim_start().starts_with("GuideRedirect"))?.split_whitespace().last().map(str::to_string)
}
#[cfg(not(windows))]
fn installer_value() -> Option<String> { None }

#[cfg(windows)]
fn resident_on() -> bool { quiet_reg(&["query", RUN_KEY, "/v", RUN_VALUE]).is_some_and(|output| output.status.success()) }

/// The sign-in entry, and the watcher now so it works before the next sign-in.
#[cfg(windows)]
fn set_resident(on: bool) {
    use std::os::windows::process::CommandExt;
    if !on { quiet_reg(&["delete", RUN_KEY, "/v", RUN_VALUE, "/f"]); return; }
    let Ok(exe) = std::env::current_exe() else { return };
    let command = format!("\"{}\" --guide-watch", exe.display());
    quiet_reg(&["add", RUN_KEY, "/v", RUN_VALUE, "/t", "REG_SZ", "/d", &command, "/f"]);
    let _ = std::process::Command::new(exe).arg("--guide-watch").creation_flags(0x0800_0000).spawn();
}
#[cfg(not(windows))]
fn set_resident(_on: bool) {}

/// main(): this process is the watcher. Also notes that the button started the app.
pub fn run_watcher_if_requested() -> bool {
    let args: Vec<String> = std::env::args().collect();
    if args.iter().any(|arg| arg == "--big-picture") { OPENED_BY_BUTTON.store(true, Ordering::SeqCst); }
    if !args.iter().any(|arg| arg == "--guide-watch") { return false; }
    #[cfg(windows)]
    watch_with_the_app_closed();
    true
}

/// One watcher per Windows session; the mutex lives as long as the process.
#[cfg(windows)]
fn first_watcher() -> bool {
    #[link(name = "kernel32")]
    extern "system" {
        fn CreateMutexW(attributes: *const std::ffi::c_void, owner: i32, name: *const u16) -> *mut std::ffi::c_void;
        fn GetLastError() -> u32;
    }
    const ERROR_ALREADY_EXISTS: u32 = 183;
    let name: Vec<u16> = "Local\\GameAccessGuideWatch\0".encode_utf16().collect();
    let mutex = unsafe { CreateMutexW(std::ptr::null(), 0, name.as_ptr()) };
    !mutex.is_null() && unsafe { GetLastError() } != ERROR_ALREADY_EXISTS
}

/// The app is open when this program runs twice: the watcher and the app. Then the app answers the button by itself.
#[cfg(windows)]
fn app_open(exe: &str) -> bool {
    crate::game_focus::process_images().iter().filter(|process| process.image.eq_ignore_ascii_case(exe)).count() > 1
}

#[cfg(windows)]
fn watch_with_the_app_closed() {
    use std::os::windows::process::CommandExt;
    if !first_watcher() { return; }
    let Ok(exe) = std::env::current_exe() else { return };
    let path = exe.to_string_lossy().into_owned();
    let mut held = [false; 4];
    loop {
        let mut connected = false;
        for slot in 0..4usize {
            let Some(pressed) = guide_pressed(slot as u32) else { held[slot] = false; continue };
            connected = true;
            if pressed && !held[slot] && !app_open(&path) && !steam_game_running() {
                if !resident_on() { return; }
                let _ = std::process::Command::new(&exe).arg("--big-picture").creation_flags(0x0800_0000).spawn();
            }
            held[slot] = pressed;
        }
        std::thread::sleep(std::time::Duration::from_millis(if connected { 60 } else { 1500 }));
    }
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

/// None: no controller in that slot.
#[cfg(windows)]
fn guide_pressed(slot: u32) -> Option<bool> {
    let mut state = xinput::State::default();
    (unsafe { xinput::XInputGetStateEx(slot, &mut state) } == 0).then_some(state.gamepad.buttons & xinput::GUIDE != 0)
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
                let pressed = guide_pressed(slot) == Some(true);
                if pressed && !held[slot as usize] && !crate::webview_rest::game_running() && !steam_game_running() {
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
    fn turns_the_steam_setting_off_at_the_top_of_the_file() {
        let text = "\"UserLocalConfigStore\"\n{\n\t\"system\"\n\t{\n\t\t\"Controller_CheckGuideButton\"\t\t\"1\"\n\t}\n}\n";
        let off = focus_off(text).unwrap();
        assert!(off.ends_with("\t}\n\t\"Controller_CheckGuideButton\"\t\t\"0\"\n}\n"));
        assert_eq!(focus_off(&off), None);
        assert_eq!(focus_default(&off).as_deref(), Some(text));
        let on = off.replace("\t\"Controller_CheckGuideButton\"\t\t\"0\"\n}", "\t\"Controller_CheckGuideButton\"\t\t\"1\"\n}");
        assert_eq!(focus_off(&on).as_deref(), Some(off.as_str()));
        assert_eq!(focus_off("\"Other\"\n{\n}\n"), None);
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
