//! Kid mode (vault/Modo niño.md): a child's Windows account opens Game Access instead of the desktop, sees only the
//! games the adult chose and plays them within a daily time.
//!
//! The family file (`%ProgramData%\GameAccess\familia.json`) says which accounts are children and what each one may
//! play. Only an administrator writes it: the adult's Game Access asks Windows for permission once per change and runs
//! `kid-account.ps1 -FromFamily`, which also sets the child's account up (its desktop, hours, what it may run). Every
//! account reads it, and the child's Game Access finds itself in it by its account's SID.
//!
//! In the child's account Game Access starts with `--kid-shell` (the account's desktop): that first process only
//! watches the real one, opens it again if it falls, and signs the child out when it closes. The time played is kept
//! in the child's own `%LOCALAPPDATA%` (version 1: no desktop or explorer to reach it; the SYSTEM service keeps it later).

use serde::{Deserialize, Deserializer, Serialize};
use std::path::{Path, PathBuf};
use std::process::{Child, Command};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

#[cfg(windows)]
use std::os::windows::process::CommandExt;
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

pub const SHELL_FLAG: &str = "--kid-shell";
/// How often a running game is checked and its time counted.
const TICK: Duration = Duration::from_secs(5);
/// Launchers start the real game and exit: this long without any process of the game ends the session.
const APPEAR_GRACE: Duration = Duration::from_secs(90);

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct KidGame {
    /// A library game's Steam AppID; a shortcut to another program is `-id` (app_shortcuts.rs).
    pub app_id: i64,
    pub name: String,
    pub folder: String,
    /// Empty for a Steam game: Steam starts it. May hold `%LOCALAPPDATA%` and the like (a shortcut).
    pub executable: String,
    #[serde(deserialize_with = "one_or_many")]
    pub arguments: Vec<String>,
    pub steam: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Kid {
    pub name: String,
    pub sid: String,
    pub enabled: bool,
    /// 0: no daily limit.
    pub daily_minutes: u32,
    /// Allowed sign-in hours, "from-to" in local time ("0-24": all day).
    pub weekdays: String,
    pub weekend: String,
    pub games: Vec<KidGame>,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Family {
    pub version: u32,
    pub kids: Vec<Kid>,
}

/// PowerShell's ConvertTo-Json writes a one-item list as the item itself.
fn one_or_many<'de, D: Deserializer<'de>>(deserializer: D) -> Result<Vec<String>, D::Error> {
    #[derive(Deserialize)]
    #[serde(untagged)]
    enum Shape { One(String), Many(Vec<String>), Nothing(()) }
    Ok(match Shape::deserialize(deserializer)? { Shape::One(item) => vec![item], Shape::Many(items) => items, Shape::Nothing(()) => vec![] })
}

fn family_path() -> PathBuf {
    let base = std::env::var_os("ProgramData").map(PathBuf::from).unwrap_or_else(|| PathBuf::from(r"C:\ProgramData"));
    base.join("GameAccess").join("familia.json")
}

fn read_family(path: &Path) -> Family {
    std::fs::read_to_string(path).ok()
        .and_then(|text| serde_json::from_str(text.trim_start_matches('\u{feff}')).ok())
        .unwrap_or_default()
}

/// The SID of the account this process runs as (`whoami /user`: "domain\user","S-1-5-...").
fn current_sid() -> Option<String> {
    let mut command = Command::new("whoami");
    command.args(["/user", "/fo", "csv", "/nh"]);
    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);
    let output = command.output().ok()?;
    let text = String::from_utf8_lossy(&output.stdout);
    text.trim().rsplit(',').next().map(|sid| sid.trim().trim_matches('"').to_string()).filter(|sid| sid.starts_with("S-1-"))
}

fn kid_for(family: &Family, sid: &str) -> Option<Kid> {
    family.kids.iter().find(|kid| kid.enabled && kid.sid.eq_ignore_ascii_case(sid)).cloned()
}

/// The child this Game Access runs for, read once: the account does not change while it runs.
pub fn kid_account() -> Option<Kid> {
    static KID: OnceLock<Option<Kid>> = OnceLock::new();
    KID.get_or_init(|| current_sid().and_then(|sid| kid_for(&read_family(&family_path()), &sid))).clone()
}

/// Signs the child out of Windows, back to the account choice.
pub fn sign_out() {
    let mut command = Command::new("shutdown");
    command.arg("/l");
    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);
    let _ = command.spawn();
}

/// `gameaccess-desktop.exe --kid-shell`, the child's desktop: runs the real app and opens it again when it falls; a
/// normal close signs the child out. Returns whether this process was that watcher (then it must not go on).
pub fn run_shell_if_requested() -> bool {
    if !std::env::args().any(|arg| arg == SHELL_FLAG) { return false; }
    let Ok(exe) = std::env::current_exe() else { sign_out(); return true };
    let mut falls = 0;
    loop {
        let started = Instant::now();
        match Command::new(&exe).status() {
            Ok(status) if status.success() => break,
            _ => {
                // Falling again and again right away: stop and sign out instead of looping.
                falls = if started.elapsed() < Duration::from_secs(20) { falls + 1 } else { 0 };
                if falls >= 3 { break; }
            }
        }
    }
    sign_out();
    true
}

#[derive(Serialize, Deserialize, Default, Clone)]
struct Usage { date: String, seconds: u64 }

fn usage_path() -> Option<PathBuf> {
    std::env::var_os("LOCALAPPDATA").map(|base| PathBuf::from(base).join("gameAccess").join("kid-time.json"))
}

fn today() -> String { chrono::Local::now().format("%Y-%m-%d").to_string() }

fn played_today() -> u64 {
    let Some(path) = usage_path() else { return 0 };
    let usage: Usage = std::fs::read_to_string(path).ok().and_then(|text| serde_json::from_str(&text).ok()).unwrap_or_default();
    if usage.date == today() { usage.seconds } else { 0 }
}

fn add_played(seconds: u64) -> u64 {
    let total = played_today() + seconds;
    if let Some(path) = usage_path() {
        if let Some(parent) = path.parent() { let _ = std::fs::create_dir_all(parent); }
        let _ = std::fs::write(path, serde_json::to_string(&Usage { date: today(), seconds: total }).unwrap_or_default());
    }
    total
}

/// What is left today, in seconds; None without a daily limit.
fn remaining(kid: &Kid, played: u64) -> Option<u64> {
    (kid.daily_minutes > 0).then(|| (kid.daily_minutes as u64 * 60).saturating_sub(played))
}

struct Playing { app_id: i64, child: Option<Child> }
static PLAYING: Mutex<Option<Playing>> = Mutex::new(None);
static TIME_UP: Mutex<bool> = Mutex::new(false);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KidSession {
    kid: Kid,
    played_seconds: u64,
    remaining_seconds: Option<u64>,
    playing: Option<i64>,
    time_up: bool,
}

/// The child's session, or None in any other account (the app then opens as always).
#[tauri::command]
pub fn kid_session() -> Option<KidSession> {
    let kid = kid_account()?;
    let played = played_today();
    let playing = PLAYING.lock().ok().and_then(|playing| playing.as_ref().map(|game| game.app_id));
    let time_up = TIME_UP.lock().map(|flag| *flag).unwrap_or(false) || remaining(&kid, played) == Some(0);
    Some(KidSession { remaining_seconds: remaining(&kid, played), played_seconds: played, playing, time_up, kid })
}

/// Starts one of the child's games, if it is one of them and there is time left.
#[tauri::command]
pub fn kid_play(app_id: i64) -> Result<(), String> {
    let kid = kid_account().ok_or("not_kid")?;
    let game = kid.games.iter().find(|game| game.app_id == app_id).cloned().ok_or("not_allowed")?;
    if remaining(&kid, played_today()) == Some(0) { return Err("time_up".into()); }
    let mut playing = PLAYING.lock().map_err(|_| "busy")?;
    if playing.is_some() { return Err("already_playing".into()); }
    let child = if game.steam {
        let mut command = Command::new("cmd");
        command.args(["/c", "start", "", &format!("steam://rungameid/{app_id}")]);
        #[cfg(windows)]
        command.creation_flags(CREATE_NO_WINDOW);
        command.spawn().map_err(|error| error.to_string())?;
        None
    } else {
        crate::app_shortcuts::launch(&game.executable, &game.arguments)?
    };
    *playing = Some(Playing { app_id, child });
    drop(playing);
    std::thread::spawn(move || watch(kid, game));
    Ok(())
}

/// Counts the time while the game runs (any process from its folder) and closes it when the day's time is over.
fn watch(kid: Kid, game: KidGame) {
    let started = Instant::now();
    let mut seen = false;
    loop {
        std::thread::sleep(TICK);
        let pids = game_pids(&game);
        let own = PLAYING.lock().ok().and_then(|mut playing| playing.as_mut()?.child.as_mut()?.try_wait().ok().map(|done| done.is_none())).unwrap_or(false);
        let alive = own || !pids.is_empty();
        seen |= alive;
        if !alive && (seen || started.elapsed() > APPEAR_GRACE) { break; }
        if !alive { continue; }
        let total = add_played(TICK.as_secs());
        if remaining(&kid, total) == Some(0) {
            if let Ok(mut flag) = TIME_UP.lock() { *flag = true; }
            close_game(&pids);
            break;
        }
    }
    if let Ok(mut playing) = PLAYING.lock() { *playing = None; }
}

fn game_pids(game: &KidGame) -> Vec<u32> {
    #[cfg(windows)]
    return crate::game_focus::game_processes(&crate::app_shortcuts::expand(&game.folder));
    #[cfg(not(windows))]
    { let _ = game; Vec::new() }
}

/// Ends the game: every process from its folder, and the one Game Access started.
fn close_game(pids: &[u32]) {
    let own = PLAYING.lock().ok().and_then(|playing| playing.as_ref()?.child.as_ref().map(Child::id));
    let mut all: Vec<usize> = pids.iter().map(|pid| *pid as usize).collect();
    if let Some(pid) = own { all.push(pid as usize); }
    crate::process_control::terminate(all);
}

/// Signs the child out (the "Leave" button, and the end of the day's time).
#[tauri::command]
pub fn kid_sign_out() { sign_out(); }

/// The family file as it is now (the adult's kid mode screen).
#[tauri::command]
pub fn kid_family() -> Family { read_family(&family_path()) }

/// Where `kid-account.ps1` is: next to the installed app's runtime, or in a development checkout.
fn script_path() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    exe.ancestors().flat_map(|root| [root.join("runtime").join("kid-account.ps1"), root.join("tools").join("windows").join("kid-account.ps1")])
        .find(|path| path.is_file())
}

/// The child's desktop must be a program the child cannot change: inside Program Files, not an older install such
/// as `C:\gameAccess` (any account may change files in a folder made straight under `C:\`).
fn in_program_files() -> bool {
    let (Ok(exe), Some(root)) = (std::env::current_exe(), std::env::var_os("ProgramFiles")) else { return false };
    let root = root.to_string_lossy().trim_end_matches('\\').to_lowercase();
    exe.to_string_lossy().to_lowercase().starts_with(&format!("{root}\\"))
}

fn valid_name(name: &str) -> bool {
    !name.is_empty() && name.len() <= 20 && name.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
}

/// Applies the adult's settings for one child: Windows asks for permission, then `kid-account.ps1 -FromFamily`
/// creates or updates the account and writes the family file. Returns the family as it is afterwards.
#[tauri::command]
pub async fn kid_apply(kid: Kid) -> Result<Family, String> {
    if kid_account().is_some() { return Err("not_allowed".into()); }
    if !valid_name(&kid.name) { return Err("bad_name".into()); }
    if !cfg!(debug_assertions) && !in_program_files() { return Err("not_program_files".into()); }
    tauri::async_runtime::spawn_blocking(move || apply_elevated(&kid)).await.map_err(|error| error.to_string())?
}

fn apply_elevated(kid: &Kid) -> Result<Family, String> {
    let script = script_path().ok_or("missing_script")?;
    let request = std::env::temp_dir().join(format!("gameaccess-kid-{}.json", uuid::Uuid::new_v4()));
    let error_file = PathBuf::from(format!("{}.error", request.display()));
    std::fs::write(&request, serde_json::to_string(kid).map_err(|error| error.to_string())?).map_err(|error| error.to_string())?;
    let inner = format!("-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File \"{}\" -FromFamily \"{}\"", script.display(), request.display());
    let outer = format!("$p = Start-Process powershell -Verb RunAs -Wait -PassThru -WindowStyle Hidden -ArgumentList '{}'; exit $p.ExitCode", inner.replace('\'', "''"));
    let mut command = Command::new("powershell");
    command.args(["-NoProfile", "-NonInteractive", "-Command", &outer]);
    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);
    let output = command.output().map_err(|error| error.to_string());
    let failure = std::fs::read_to_string(&error_file).ok();
    let _ = std::fs::remove_file(&request);
    let _ = std::fs::remove_file(&error_file);
    let output = output?;
    if let Some(message) = failure { return Err(message.trim().to_string()); }
    // Start-Process fails when the person says no to Windows' permission question.
    if !output.status.success() { return Err("cancelled".into()); }
    Ok(read_family(&family_path()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_child_is_found_by_its_account_and_only_while_enabled() {
        let text = r#"{"version":1,"kids":[{"name":"Prueba","sid":"S-1-5-21-1-2-3-1007","enabled":true,"dailyMinutes":60,
            "weekdays":"16-20","weekend":"10-21","games":[{"appId":620,"name":"Portal 2","folder":"C:\\g","executable":"C:\\g\\p.exe","arguments":"-novr","steam":false}]}]}"#;
        let family: Family = serde_json::from_str(text).unwrap();
        let kid = kid_for(&family, "s-1-5-21-1-2-3-1007").unwrap();
        assert_eq!(kid.games[0].arguments, vec!["-novr"]);
        assert!(kid_for(&family, "S-1-5-21-1-2-3-1001").is_none());
        let mut off = family.clone();
        off.kids[0].enabled = false;
        assert!(kid_for(&off, "S-1-5-21-1-2-3-1007").is_none());
    }

    #[test]
    fn the_day_runs_out_only_with_a_limit() {
        let kid = Kid { daily_minutes: 1, ..Default::default() };
        assert_eq!(remaining(&kid, 30), Some(30));
        assert_eq!(remaining(&kid, 90), Some(0));
        assert_eq!(remaining(&Kid::default(), 9999), None);
        assert!(valid_name("Prueba") && !valid_name("Juan Pérez") && !valid_name(""));
    }
}
