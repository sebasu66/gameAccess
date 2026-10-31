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
use std::collections::{BTreeMap, HashMap};
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
    /// A shortcut's program (may hold `%LOCALAPPDATA%` and the like). A library game starts like on the adult's account
    /// (the library's play: fix, language, before-play steps, administrator), so for it this is only what was found.
    pub executable: String,
    #[serde(deserialize_with = "one_or_many")]
    pub arguments: Vec<String>,
    pub steam: bool,
    /// Most minutes per day for this game, inside the daily limit; 0: only the daily limit applies.
    pub daily_minutes: u32,
    /// The game asks to run as administrator: the child's account is then made an administrator (Windows asks the
    /// child to confirm, with no password).
    pub administrator: bool,
    /// Its pictures, resolved by the adult's Game Access when applying (the child's account has none of its cache): the
    /// portrait cover and the landscape picture. Empty: the child's screen asks for them itself.
    pub cover: String,
    pub header: String,
    /// The adult's favourite or most played games: shown large (landscape) on the child's screen.
    pub featured: bool,
    /// The Steam account that owns it (as imported into the library): the child's screen names it, since Steam's own
    /// sign-in window does not fill it in the first time on the child's account.
    pub steam_account: String,
}

/// One day of the week: most minutes of play (0: no limit) and the hours the child may sign in, `from` to `to`.
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(default)]
pub struct KidDayLimit {
    pub minutes: u32,
    pub from: u8,
    pub to: u8,
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
    /// Each day of the week, Sunday first; when all seven are there they rule over `daily_minutes` and the two windows.
    pub days: Vec<KidDayLimit>,
    /// The adult's library (the launcher's data): the child's Game Access plays from it, with the same records.
    pub library: String,
    /// The adult's Game Access language ("es" or "en"): the child's screen speaks it, whatever Windows does.
    pub language: String,
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

/// One day's play: `games` is seconds per game (by AppID); `seconds` is the total of all of them.
#[derive(Serialize, Deserialize, Default, Clone, Debug)]
#[serde(default)]
struct DayUsage { seconds: u64, games: HashMap<String, u64> }
type Usage = DayUsage;

/// The last days kept (the adult's screen shows the week). The `date`/`seconds`/`games` fields are the older format,
/// one day only; they are read into `days` and not written again.
#[derive(Serialize, Deserialize, Default)]
#[serde(default)]
struct UsageFile { days: BTreeMap<String, DayUsage>, date: String, seconds: u64, games: HashMap<String, u64> }
const DAYS_KEPT: usize = 30;

fn read_usage(path: &Path) -> UsageFile {
    let mut file: UsageFile = std::fs::read_to_string(path).ok().and_then(|text| serde_json::from_str(&text).ok()).unwrap_or_default();
    if !file.date.is_empty() {
        let date = std::mem::take(&mut file.date);
        let day = DayUsage { seconds: std::mem::take(&mut file.seconds), games: std::mem::take(&mut file.games) };
        file.days.entry(date).or_insert(day);
    }
    file
}

/// Where the adult's live orders and the child's time are shared: next to the family file, in a folder every account
/// may write (made by `kid-account.ps1`). The child's Game Access has no desktop or explorer to reach it.
fn shared_dir() -> PathBuf { family_path().parent().map(Path::to_path_buf).unwrap_or_default().join("uso") }

fn local_usage_path() -> Option<PathBuf> {
    std::env::var_os("LOCALAPPDATA").map(|base| PathBuf::from(base).join("gameAccess").join("kid-time.json"))
}

/// The child's own time file: in the shared folder when this account can write there (so the adult sees it), else in
/// its own `%LOCALAPPDATA%`.
fn usage_path() -> Option<PathBuf> {
    static PATH: OnceLock<Option<PathBuf>> = OnceLock::new();
    PATH.get_or_init(|| {
        let shared = kid_account().map(|kid| shared_dir().join(format!("{}.json", kid.sid)));
        match shared {
            Some(path) if path.parent().is_some_and(Path::is_dir) && std::fs::OpenOptions::new().create(true).append(true).open(&path).is_ok() => Some(path),
            _ => local_usage_path(),
        }
    }).clone()
}

fn today() -> String { chrono::Local::now().format("%Y-%m-%d").to_string() }

fn usage_today() -> Usage {
    let Some(path) = usage_path() else { return Usage::default() };
    read_usage(&path).days.get(&today()).cloned().unwrap_or_default()
}

/// Counts `seconds` of `app_id` in the day's total and in that game's own time; returns both totals.
fn add_played(app_id: i64, seconds: u64) -> (u64, u64) {
    let Some(path) = usage_path() else { return (0, 0) };
    let mut file = read_usage(&path);
    let day = file.days.entry(today()).or_default();
    day.seconds += seconds;
    let game = day.games.entry(app_id.to_string()).or_insert(0);
    *game += seconds;
    let (game, total) = (*game, day.seconds);
    while file.days.len() > DAYS_KEPT { if let Some(oldest) = file.days.keys().next().cloned() { file.days.remove(&oldest); } }
    if let Some(parent) = path.parent() { let _ = std::fs::create_dir_all(parent); }
    let _ = std::fs::write(path, serde_json::to_string(&file).unwrap_or_default());
    (total, game)
}

/// The adult's live orders for one child, written by the adult's Game Access (or later the phone app) and read by the
/// child's every few seconds: more time today, the day closed, or the game stopped now.
#[derive(Serialize, Deserialize, Default, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Control {
    /// Minutes added to the daily limit, valid on `extra_date` only.
    extra_date: String,
    extra_minutes: u32,
    /// The day closed for the child: no game starts and the one open is closed.
    lock_date: String,
    /// Changes with every "stop now": a running game that sees another number closes.
    stop_nonce: u64,
}

/// Whether kid mode is on while the adult's PLUS is: the adult's Game Access writes `uso\plus.json` after every activation
/// check that answered (no Windows permission needed). Missing or unreadable means on: a PC that never reported, or an
/// older version, keeps working; only an explicit `"active": false` pauses the child's account.
fn plus_flag(text: &str) -> bool {
    serde_json::from_str::<serde_json::Value>(text).ok().and_then(|value| value.get("active").and_then(serde_json::Value::as_bool)).unwrap_or(true)
}

fn plus_active() -> bool {
    std::fs::read_to_string(shared_dir().join("plus.json")).map(|text| plus_flag(&text)).unwrap_or(true)
}

fn valid_sid(sid: &str) -> bool { sid.starts_with("S-1-") && sid.chars().all(|c| c.is_ascii_digit() || c == 'S' || c == '-') }
fn control_path(sid: &str) -> PathBuf { shared_dir().join(format!("{sid}.control.json")) }

fn read_control(sid: &str) -> Control {
    std::fs::read_to_string(control_path(sid)).ok().and_then(|text| serde_json::from_str(&text).ok()).unwrap_or_default()
}

/// The child as limited today: that day's limit (or the daily one) plus the minutes the adult added (no limit stays no limit).
fn with_control(mut kid: Kid, control: &Control, today: &str) -> Kid {
    if kid.days.len() == 7 {
        if let Ok(date) = chrono::NaiveDate::parse_from_str(today, "%Y-%m-%d") {
            use chrono::Datelike;
            kid.daily_minutes = kid.days[date.weekday().num_days_from_sunday() as usize].minutes;
        }
    }
    if kid.daily_minutes > 0 && control.extra_date == today { kid.daily_minutes += control.extra_minutes; }
    kid
}

fn apply_control(mut control: Control, action: &str, minutes: u32, today: &str, nonce: u64) -> Result<Control, String> {
    match action {
        "extend" => {
            if control.extra_date != today { control.extra_date = today.to_string(); control.extra_minutes = 0; }
            control.extra_minutes = (control.extra_minutes + minutes.clamp(1, 600)).min(1440);
        }
        "lock" => control.lock_date = today.to_string(),
        "unlock" => control.lock_date.clear(),
        "stop" => control.stop_nonce = nonce,
        _ => return Err("bad_action".into()),
    }
    Ok(control)
}

/// The games played in the `days` up to `today`, most played first.
fn recent_games(file: &UsageFile, today: &str, days: i64) -> Vec<i64> {
    let Ok(end) = chrono::NaiveDate::parse_from_str(today, "%Y-%m-%d") else { return Vec::new() };
    let mut seconds: HashMap<i64, u64> = HashMap::new();
    for ago in 0..days {
        let date = (end - chrono::Duration::days(ago)).format("%Y-%m-%d").to_string();
        for (game, played) in file.days.get(&date).map(|day| &day.games).into_iter().flatten() {
            if let Ok(app_id) = game.parse::<i64>() { *seconds.entry(app_id).or_default() += played; }
        }
    }
    let mut games: Vec<(i64, u64)> = seconds.into_iter().filter(|(_, played)| *played > 0).collect();
    games.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(&b.0)));
    games.into_iter().map(|(app_id, _)| app_id).collect()
}

/// What is left today, in seconds; None without a daily limit.
fn remaining(kid: &Kid, played: u64) -> Option<u64> {
    (kid.daily_minutes > 0).then(|| (kid.daily_minutes as u64 * 60).saturating_sub(played))
}

/// What is left today of one game's own limit; None when it has none.
fn game_remaining(game: &KidGame, played: u64) -> Option<u64> {
    (game.daily_minutes > 0).then(|| (game.daily_minutes as u64 * 60).saturating_sub(played))
}

/// What is left to play `game` today: the least of its own limit and the day's.
fn left_for(kid: &Kid, game: &KidGame, usage: &Usage) -> Option<u64> {
    let own = game_remaining(game, usage.games.get(&game.app_id.to_string()).copied().unwrap_or(0));
    match (own, remaining(kid, usage.seconds)) { (Some(a), Some(b)) => Some(a.min(b)), (a, b) => a.or(b) }
}

struct Playing { app_id: i64, child: Option<Child> }
static PLAYING: Mutex<Option<Playing>> = Mutex::new(None);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KidSession {
    kid: Kid,
    played_seconds: u64,
    remaining_seconds: Option<u64>,
    playing: Option<i64>,
    time_up: bool,
    /// PLUS ended: kid mode is paused, nothing plays until it is back.
    paused: bool,
    /// Seconds left today of each game that has its own limit (by AppID), for the games screen.
    game_remaining: HashMap<i64, u64>,
    /// What the child played in the last week, most played first (by AppID): shown large on the games screen.
    recent: Vec<i64>,
}

/// The child's session, or None in any other account (the app then opens as always).
#[tauri::command]
pub fn kid_session() -> Option<KidSession> {
    let kid = kid_account()?;
    let usage = usage_today();
    let played = usage.seconds;
    let control = read_control(&kid.sid);
    let limited = with_control(kid.clone(), &control, &today());
    let playing = PLAYING.lock().ok().and_then(|playing| playing.as_ref().map(|game| game.app_id));
    let time_up = control.lock_date == today() || remaining(&limited, played) == Some(0);
    let game_remaining = kid.games.iter().filter(|game| game.daily_minutes > 0)
        .filter_map(|game| Some((game.app_id, game_remaining(game, usage.games.get(&game.app_id.to_string()).copied().unwrap_or(0))?))).collect();
    let recent = usage_path().map(|path| recent_games(&read_usage(&path), &today(), 7)).unwrap_or_default();
    Some(KidSession { remaining_seconds: remaining(&limited, played), played_seconds: played, playing, time_up, paused: !plus_active(), game_remaining, recent, kid })
}

/// Starts one of the child's games, if it is one of them and there is time left. Off the main thread: the library's
/// play may first thaw the game or put its fix back.
#[tauri::command]
pub async fn kid_play(app_id: i64) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || play_now(app_id)).await.map_err(|error| error.to_string())?
}

fn play_now(app_id: i64) -> Result<(), String> {
    let kid = kid_account().ok_or("not_kid")?;
    let Some(game) = kid.games.iter().find(|game| game.app_id == app_id).cloned() else {
        play_log(&kid.sid, "WARN", format!("Play {app_id}: not among the child's games."));
        return Err("not_allowed".into());
    };
    let how = if app_id > 0 { format!("through the library's play, in {:?}", game.folder) } else { format!("{:?} {:?}", game.executable, game.arguments) };
    play_log(&kid.sid, "INFO", format!("Play {:?} ({app_id}) {how}.", game.name));
    let result = start_kid_game(&kid, &game, app_id);
    match &result {
        Ok(()) => play_log(&kid.sid, "INFO", format!("Started {:?}.", game.name)),
        Err(error) => play_log(&kid.sid, if matches!(error.as_str(), "paused" | "time_up" | "game_time_up" | "already_playing") { "WARN" } else { "ERROR" }, format!("{:?} did not start: {error}.", game.name)),
    }
    result
}

/// Each try to play, in the child's own log and in the shared folder (uso\<sid>.log), which the adult's account can
/// read: a game that does not open on the child's account must say why somewhere the parent can see.
fn play_log(sid: &str, level: &str, message: String) {
    log(level, message.clone());
    if !valid_sid(sid) { return; }
    let line = format!("{} [{level}] {message}
", chrono::Local::now().format("%Y-%m-%d %H:%M:%S"));
    let path = shared_dir().join(format!("{sid}.log"));
    if let Ok(mut file) = std::fs::OpenOptions::new().create(true).append(true).open(path) { let _ = std::io::Write::write_all(&mut file, line.as_bytes()); }
}

fn start_kid_game(kid: &Kid, game: &KidGame, app_id: i64) -> Result<(), String> {
    let kid = kid.clone();
    let game = game.clone();
    if !plus_active() { return Err("paused".into()); }
    let usage = usage_today();
    let control = read_control(&kid.sid);
    let limited = with_control(kid.clone(), &control, &today());
    if control.lock_date == today() || remaining(&limited, usage.seconds) == Some(0) { return Err("time_up".into()); }
    if left_for(&limited, &game, &usage) == Some(0) { return Err("game_time_up".into()); }
    {
        let mut playing = PLAYING.lock().map_err(|_| "busy")?;
        if playing.is_some() { return Err("already_playing".into()); }
        // Taken now: the library's play can take a while (a thaw) and a second tap must not start another game.
        *playing = Some(Playing { app_id, child: None });
    }
    let started = launch(&game, app_id);
    let Ok(mut playing) = PLAYING.lock() else { return Err("busy".into()) };
    match started {
        Ok(child) => { *playing = Some(Playing { app_id, child }); drop(playing); std::thread::spawn(move || watch(kid, game)); Ok(()) }
        Err(error) => { *playing = None; Err(error) }
    }
}

/// A library game: the same play as on the adult's account, over the adult's library (configure_launcher_data points the
/// launcher at it). A shortcut to another program: that program.
fn launch(game: &KidGame, app_id: i64) -> Result<Option<Child>, String> {
    if app_id > 0 {
        let result = crate::digital_commands::run_runner("play", app_id as u32, &game.name, "", None, None, None)?;
        if result.get("ok").and_then(serde_json::Value::as_bool) == Some(true) { return Ok(None); }
        return Err(result.get("error").and_then(serde_json::Value::as_str).unwrap_or("play_failed").to_string());
    }
    if game.executable.trim().is_empty() { return Err("no_executable".into()); }
    crate::app_shortcuts::launch(&game.executable, &game.arguments)
}

/// Counts the time while the game runs (any process from its folder) and closes it when the day's time is over.
fn watch(kid: Kid, game: KidGame) {
    let started = Instant::now();
    let mut seen = false;
    let stop_nonce = read_control(&kid.sid).stop_nonce;
    loop {
        std::thread::sleep(TICK);
        let pids = game_pids(&game);
        // The adult's live orders: "stop now" (another number than at the start) and the day closed.
        let control = read_control(&kid.sid);
        if control.stop_nonce != stop_nonce || control.lock_date == today() || !plus_active() { end_game(&game, &pids); break; }
        let limited = with_control(kid.clone(), &control, &today());
        let own = PLAYING.lock().ok().and_then(|mut playing| playing.as_mut()?.child.as_mut()?.try_wait().ok().map(|done| done.is_none())).unwrap_or(false);
        let alive = own || !pids.is_empty();
        seen |= alive;
        if !alive && (seen || started.elapsed() > APPEAR_GRACE) { break; }
        if !alive { continue; }
        let (total, own) = add_played(game.app_id, TICK.as_secs());
        if remaining(&limited, total) == Some(0) {
            end_game(&game, &pids);
            break;
        }
        // Only this game's own time is over: it closes, the child may still play the others.
        if game_remaining(&game, own) == Some(0) {
            end_game(&game, &pids);
            break;
        }
    }
    // Only its own mark: a game started after this one was closed by hand (kid_stop_playing) keeps its own.
    if let Ok(mut playing) = PLAYING.lock() { if playing.as_ref().is_some_and(|current| current.app_id == game.app_id) { *playing = None; } }
}

fn game_pids(game: &KidGame) -> Vec<u32> {
    #[cfg(windows)]
    return crate::game_focus::game_processes(&crate::app_shortcuts::expand(&game.folder));
    #[cfg(not(windows))]
    { let _ = game; Vec::new() }
}

/// Closes the game; one that does not let itself be closed (it runs as administrator, and this app does not) still ends:
/// the child is signed out, which closes everything in the account.
fn end_game(game: &KidGame, pids: &[u32]) {
    close_game(pids);
    std::thread::sleep(Duration::from_secs(10));
    if !game_pids(game).is_empty() {
        log("WARN", format!("{:?} did not close when its time was over: signing the child out.", game.name));
        sign_out();
    }
}

/// Ends the game: every process from its folder, and the one Game Access started.
fn close_game(pids: &[u32]) {
    let own = PLAYING.lock().ok().and_then(|playing| playing.as_ref()?.child.as_ref().map(Child::id));
    let mut all: Vec<usize> = pids.iter().map(|pid| *pid as usize).collect();
    if let Some(pid) = own { all.push(pid as usize); }
    crate::process_control::terminate(all);
}

/// Kid mode's guard (Seba, 2026-10-31: after signing in, Steam's own window let the child start a game that was not one
/// of his). Steam cannot be closed off from inside (its library, Big Picture with a controller's Guide button, "add a
/// non-Steam game"), so what it starts is checked instead: while the child's Game Access runs (it is the account's
/// desktop), anything Steam starts, or anything running from a Steam library's `steamapps\common`, is closed at once
/// unless it lives in one of the child's games' folders. Steam's own programs and its shared redistributables (first
/// run installers) stay. A game the child cannot close (it runs as administrator) signs the child out.
const GUARD_TICK: Duration = Duration::from_secs(1);
const GUARD_SIGN_OUT_AFTER: Duration = Duration::from_secs(10);
/// Other stores' launchers, as parts of their install path (lower case), which games bought there open through
/// (Seba, 2026-10-31: Ubisoft Connect): never closed.
const LAUNCHERS: &[&str] = &[r"\ubisoft\ubisoft game launcher\", r"\electronic arts\ea desktop\", r"\epic games\launcher\",
    r"\rockstar games\launcher\", r"\battle.net\", r"\gog galaxy\"];

fn guard_norm(path: &str) -> String { path.replace('/', "\\").to_lowercase() }

/// The processes to close: started by Steam or living in a Steam library, and outside the allowed folders.
fn not_allowed<'a>(processes: &'a [crate::game_focus::ProcessImage], allowed: &[String]) -> Vec<&'a crate::game_focus::ProcessImage> {
    let steam: Vec<&crate::game_focus::ProcessImage> = processes.iter().filter(|process| guard_norm(&process.image).ends_with(r"\steam.exe")).collect();
    let steam_dirs: Vec<String> = steam.iter().filter_map(|process| Path::new(&process.image).parent().map(|dir| dir.display().to_string())).collect();
    processes.iter().filter(|process| {
        let image = guard_norm(&process.image);
        if allowed.iter().any(|folder| crate::game_focus::is_inside(folder, &process.image)) { return false; }
        if image.contains(r"\steamapps\common\steamworks shared\") { return false; }
        if LAUNCHERS.iter().any(|part| image.contains(part)) { return false; }
        let in_library = image.contains(r"\steamapps\common\");
        let from_steam = steam.iter().any(|parent| parent.pid == process.parent) && !steam_dirs.iter().any(|dir| crate::game_focus::is_inside(dir, &process.image));
        in_library || from_steam
    }).collect()
}

/// Starts the guard in a child's account (nothing in any other). Steam is also asked to start minimised there.
pub fn start_guard(app: tauri::AppHandle) {
    let Some(kid) = kid_account() else { return };
    // The launcher's Steam switch (steam_account_manager/switch.py) starts Steam with -silent: no window after signing in.
    std::env::set_var("GAMEACCESS_STEAM_SILENT", "1");
    std::thread::spawn(move || guard_loop(app, kid));
}

fn guard_loop(app: tauri::AppHandle, kid: Kid) {
    use tauri::{Emitter, Manager};
    let allowed: Vec<String> = kid.games.iter().map(|game| crate::app_shortcuts::expand(&game.folder)).filter(|folder| !folder.trim().is_empty()).collect();
    let mut first_seen: HashMap<u32, Instant> = HashMap::new();
    loop {
        std::thread::sleep(GUARD_TICK);
        #[cfg(windows)]
        let processes = crate::game_focus::process_images();
        #[cfg(not(windows))]
        let processes: Vec<crate::game_focus::ProcessImage> = Vec::new();
        let closing = not_allowed(&processes, &allowed);
        first_seen.retain(|pid, _| closing.iter().any(|process| process.pid == *pid));
        if closing.is_empty() { continue; }
        let mut new_names = Vec::new();
        for process in &closing {
            let seen = *first_seen.entry(process.pid).or_insert_with(Instant::now);
            if seen.elapsed() >= GUARD_SIGN_OUT_AFTER {
                play_log(&kid.sid, "WARN", format!("{:?} is not allowed and could not be closed: signing the child out.", process.image));
                sign_out();
                return;
            }
            if seen.elapsed() < GUARD_TICK { new_names.push(Path::new(&process.image).file_stem().map(|name| name.to_string_lossy().to_string()).unwrap_or_default()); }
        }
        crate::process_control::terminate(closing.iter().map(|process| process.pid as usize).collect());
        if !new_names.is_empty() {
            play_log(&kid.sid, "WARN", format!("Closed what is not among the child's games: {}.", new_names.join(", ")));
            // Game Access comes back to the front and tells the child why.
            if let Some(window) = app.get_webview_window("main") { let _ = window.unminimize(); let _ = window.show(); let _ = window.set_focus(); }
            let _ = app.emit("gameaccess:kid-blocked", new_names.join(", "));
        }
    }
}

/// Closes the game the child is playing, so another can start (Seba, 2026-10-31: the child's screen refused a game
/// while another ran; now it asks, and "close the one before and open this" lands here). Waits until it is gone.
#[tauri::command]
pub async fn kid_stop_playing() -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(stop_playing).await.map_err(|error| error.to_string())?
}

fn stop_playing() -> Result<(), String> {
    let kid = kid_account().ok_or("not_kid")?;
    let current = PLAYING.lock().ok().and_then(|playing| playing.as_ref().map(|game| game.app_id));
    let Some(app_id) = current else { return Ok(()) };
    if let Some(game) = kid.games.iter().find(|game| game.app_id == app_id) {
        play_log(&kid.sid, "INFO", format!("Close {:?} to open another game.", game.name));
        close_game(&game_pids(game));
        let started = Instant::now();
        while !game_pids(game).is_empty() {
            if started.elapsed() > Duration::from_secs(10) {
                play_log(&kid.sid, "WARN", format!("{:?} did not close.", game.name));
                return Err("still_running".into());
            }
            std::thread::sleep(Duration::from_millis(300));
        }
    }
    if let Ok(mut playing) = PLAYING.lock() { *playing = None; }
    Ok(())
}

/// Signs the child out (the "Leave" button, and the end of the day's time).
#[tauri::command]
pub fn kid_sign_out() { sign_out(); }

/// The family file as it is now (the adult's kid mode screen).
#[tauri::command]
pub fn kid_family() -> Family { read_family(&family_path()) }

/// Whether the kid mode wizard was finished: a child is in the family file. Until then the parent's key is asleep
/// (admin_key.rs).
pub fn kid_mode_set_up() -> bool { !read_family(&family_path()).kids.is_empty() }

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DayRow { date: String, seconds: u64, games: HashMap<String, u64> }

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KidLive {
    /// The last 7 days, oldest first, today last.
    days: Vec<DayRow>,
    extra_minutes: u32,
    locked_today: bool,
    /// False until the account is applied with the version that makes the shared folder: no live orders yet.
    channel: bool,
}

/// What the adult's screen shows of a child: the week's time and the live orders in force today.
#[tauri::command]
pub fn kid_live(sid: String) -> KidLive {
    if !valid_sid(&sid) { return KidLive { days: vec![], extra_minutes: 0, locked_today: false, channel: false }; }
    let file = read_usage(&shared_dir().join(format!("{sid}.json")));
    let now = chrono::Local::now().date_naive();
    let days = (0..7).rev().map(|ago| {
        let date = (now - chrono::Duration::days(ago)).format("%Y-%m-%d").to_string();
        let day = file.days.get(&date).cloned().unwrap_or_default();
        DayRow { date, seconds: day.seconds, games: day.games }
    }).collect();
    let control = read_control(&sid);
    let now = today();
    KidLive { days, extra_minutes: if control.extra_date == now { control.extra_minutes } else { 0 }, locked_today: control.lock_date == now, channel: shared_dir().is_dir() }
}

/// The adult's Game Access reports what its activation check found: PLUS on (kid mode runs) or off (it is paused). Nothing
/// is deleted either way. Before an account was applied there is no shared folder and nothing to report.
#[tauri::command]
pub fn kid_plus_set(active: bool) -> Result<(), String> {
    if kid_account().is_some() { return Err("not_allowed".into()); }
    if !shared_dir().is_dir() { return Ok(()); }
    let text = serde_json::json!({ "active": active, "at": chrono::Local::now().to_rfc3339() }).to_string();
    std::fs::write(shared_dir().join("plus.json"), text).map_err(|error| error.to_string())
}

/// A live order from the adult: "extend" (`minutes` more today), "lock" / "unlock" (the day), "stop" (the open game now).
#[tauri::command]
pub fn kid_control(sid: String, action: String, minutes: u32) -> Result<KidLive, String> {
    if kid_account().is_some() { return Err("not_allowed".into()); }
    if !valid_sid(&sid) { return Err("bad_sid".into()); }
    if !shared_dir().is_dir() { return Err("needs_apply".into()); }
    let nonce = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|time| time.as_millis() as u64).unwrap_or(1);
    let control = apply_control(read_control(&sid), &action, minutes, &today(), nonce)?;
    std::fs::write(control_path(&sid), serde_json::to_string(&control).map_err(|error| error.to_string())?).map_err(|error| error.to_string())?;
    Ok(kid_live(sid))
}

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
    let exe = std::env::current_exe().map(|path| path.display().to_string()).unwrap_or_default();
    let days = kid.days.iter().map(|day| format!("{}m {}-{}", day.minutes, day.from, day.to)).collect::<Vec<_>>().join(", ");
    log("INFO", format!("Create or update the child's account {:?}: {} game(s), enabled {}, days (Sunday first) [{days}]; app at {exe} ({} build).",
        kid.name, kid.games.len(), kid.enabled, if cfg!(debug_assertions) { "debug" } else { "release" }));
    if kid_account().is_some() { return Err(refused("not_allowed", "this app runs inside a child's account")); }
    if !valid_name(&kid.name) { return Err(refused("bad_name", "the name has characters a Windows account cannot have")); }
    if !cfg!(debug_assertions) && !in_program_files() { return Err(refused("not_program_files", &format!("the app is not inside Program Files ({exe}); the child's desktop must be a program the child cannot change"))); }
    let mut kid = kid;
    kid.library = crate::launcher_runtime::find_launcher_dir().map(|launcher| crate::launcher_runtime::launcher_data_dir(&launcher).display().to_string()).unwrap_or_default();
    tauri::async_runtime::spawn_blocking(move || apply_elevated(&kid)).await.map_err(|error| error.to_string())?
}

/// Kid mode's log (gameaccess.log, area KID_MODE): the account is made out of sight, so every step is written down.
fn log(level: &str, message: String) {
    let _ = crate::activity_log::append_narration_lines(vec![message], "KID_MODE".into(), level.into());
}

/// A request refused before Windows is asked: logged with its reason, and its code goes back to the interface.
fn refused(code: &str, why: &str) -> String {
    log("WARN", format!("Refused ({code}): {why}."));
    code.to_string()
}

fn apply_elevated(kid: &Kid) -> Result<Family, String> {
    run_script(serde_json::to_string(kid).map_err(|error| error.to_string())?)
}

/// Undoes kid mode for one child: Windows asks for permission, then `kid-account.ps1 -FromFamily` (with `remove`)
/// deletes the account and its profile and takes the child out of the family file and the time folder.
#[tauri::command]
pub async fn kid_remove(name: String) -> Result<Family, String> {
    log("INFO", format!("Remove kid mode for {name:?}."));
    if kid_account().is_some() { return Err(refused("not_allowed", "this app runs inside a child's account")); }
    if !valid_name(&name) { return Err(refused("bad_name", "the name has characters a Windows account cannot have")); }
    let request = serde_json::json!({ "name": name, "remove": true }).to_string();
    tauri::async_runtime::spawn_blocking(move || run_script(request)).await.map_err(|error| error.to_string())?
}

/// Runs the script elevated with this request (a JSON file it reads); a failure comes back as its `.error` file.
fn run_script(request_json: String) -> Result<Family, String> {
    let Some(script) = script_path() else { return Err(refused("missing_script", "kid-account.ps1 is not next to the app (in runtime or tools/windows)")); };
    let request = std::env::temp_dir().join(format!("gameaccess-kid-{}.json", uuid::Uuid::new_v4()));
    let error_file = PathBuf::from(format!("{}.error", request.display()));
    // The script writes each of its steps here; they are copied into the app's log below.
    let step_file = PathBuf::from(format!("{}.log", request.display()));
    std::fs::write(&request, request_json).map_err(|error| error.to_string())?;
    log("INFO", format!("Asking Windows for permission to run {} (request {}).", script.display(), request.display()));
    let inner = format!("-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File \"{}\" -FromFamily \"{}\"", script.display(), request.display());
    let outer = format!("$p = Start-Process powershell -Verb RunAs -Wait -PassThru -WindowStyle Hidden -ArgumentList '{}'; exit $p.ExitCode", inner.replace('\'', "''"));
    let mut command = Command::new("powershell");
    command.args(["-NoProfile", "-NonInteractive", "-Command", &outer]);
    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);
    let output = command.output().map_err(|error| error.to_string());
    let failure = std::fs::read_to_string(&error_file).ok();
    let steps = std::fs::read_to_string(&step_file).unwrap_or_default();
    for line in steps.lines().filter(|line| !line.trim().is_empty()) { log("INFO", format!("script: {}", line.trim())); }
    for path in [&request, &error_file, &step_file] { let _ = std::fs::remove_file(path); }
    let output = output.inspect_err(|error| log("ERROR", format!("PowerShell could not be started: {error}.")))?;
    if let Some(message) = failure {
        log("ERROR", format!("The script failed: {}", message.trim()));
        return Err(message.trim().to_string());
    }
    if !output.status.success() {
        let said = String::from_utf8_lossy(&output.stderr).split_whitespace().collect::<Vec<_>>().join(" ");
        // Start-Process fails this way when the person says no to Windows' permission question.
        if said.contains("canceled by the user") || said.contains("cancelada por el usuario") || said.contains("cancelado por el usuario") {
            log("WARN", "The person said no to Windows' permission question.".into());
            return Err("cancelled".into());
        }
        log("ERROR", format!("The script ended with code {:?} and no error file; PowerShell said: {said}", output.status.code()));
        return Err(format!("script_failed: {}", if said.is_empty() { format!("code {:?}", output.status.code()) } else { said }));
    }
    let family = read_family(&family_path());
    log("INFO", format!("Done: the family file has {} child(ren) ({}).", family.kids.len(), family.kids.iter().map(|kid| kid.name.as_str()).collect::<Vec<_>>().join(", ")));
    Ok(family)
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

    #[test]
    fn the_adults_live_orders_change_the_day() {
        let kid = Kid { daily_minutes: 120, ..Default::default() };
        let control = apply_control(Control::default(), "extend", 30, "2026-10-29", 1).unwrap();
        let control = apply_control(control, "extend", 15, "2026-10-29", 1).unwrap();
        assert_eq!(with_control(kid.clone(), &control, "2026-10-29").daily_minutes, 165);
        // Another day: the extra time is gone, and a new extension starts from zero.
        assert_eq!(with_control(kid.clone(), &control, "2026-10-30").daily_minutes, 120);
        assert_eq!(apply_control(control.clone(), "extend", 10, "2026-10-30", 1).unwrap().extra_minutes, 10);
        // No limit stays no limit.
        assert_eq!(with_control(Kid::default(), &control, "2026-10-29").daily_minutes, 0);
        // With the seven days, today's limit is that day's: 2026-10-31 is a Saturday, 2026-10-29 a Thursday.
        let week = Kid { days: (0..7).map(|day| KidDayLimit { minutes: if day == 0 || day == 6 { 180 } else { 120 }, from: 9, to: 21 }).collect(), ..Kid::default() };
        assert_eq!(with_control(week.clone(), &Control::default(), "2026-10-31").daily_minutes, 180);
        assert_eq!(with_control(week, &control, "2026-10-29").daily_minutes, 120 + 45);
        let locked = apply_control(control, "lock", 0, "2026-10-29", 1).unwrap();
        assert_eq!(locked.lock_date, "2026-10-29");
        assert!(apply_control(locked.clone(), "unlock", 0, "2026-10-29", 1).unwrap().lock_date.is_empty());
        assert_eq!(apply_control(locked.clone(), "stop", 0, "2026-10-29", 77).unwrap().stop_nonce, 77);
        assert!(apply_control(locked, "nope", 0, "2026-10-29", 1).is_err());
        assert!(valid_sid("S-1-5-21-1-2-3-1007") && !valid_sid("..\\evil") && !valid_sid("S-1-5\\x"));
    }

    #[test]
    fn only_an_explicit_off_pauses_kid_mode() {
        assert!(!plus_flag(r#"{"active":false,"at":"2026-10-29T10:00:00-03:00"}"#));
        assert!(plus_flag(r#"{"active":true}"#));
        // A file nobody can read, or without the answer, never pauses a child by mistake.
        assert!(plus_flag("") && plus_flag("not json") && plus_flag("{}") && plus_flag(r#"{"active":"no"}"#));
    }

    #[test]
    fn the_older_one_day_file_is_read_into_the_week() {
        let path = std::env::temp_dir().join(format!("kid-usage-{}.json", uuid::Uuid::new_v4()));
        std::fs::write(&path, r#"{"date":"2026-10-28","seconds":600,"games":{"-1":600}}"#).unwrap();
        let file = read_usage(&path);
        let _ = std::fs::remove_file(&path);
        assert_eq!(file.days["2026-10-28"].seconds, 600);
        assert_eq!(file.days["2026-10-28"].games["-1"], 600);
    }

    #[test]
    fn the_guard_closes_what_steam_starts_outside_the_childs_games() {
        use crate::game_focus::ProcessImage;
        let process = |pid: u32, parent: u32, image: &str| ProcessImage { pid, parent, image: image.into() };
        let steam = r"C:\Program Files (x86)\Steam";
        let list = vec![
            process(10, 1, &format!(r"{steam}\steam.exe")),
            process(11, 10, &format!(r"{steam}\bin\cef\cef.win7x64\steamwebhelper.exe")),
            process(12, 10, &format!(r"{steam}\steamapps\common\Portal 2\portal2.exe")),
            process(13, 10, r"E:\SteamLibrary\steamapps\common\Hades\x64\Hades.exe"),
            process(14, 10, &format!(r"{steam}\steamapps\common\Steamworks Shared\_CommonRedist\DirectX\DXSETUP.exe")),
            process(15, 10, r"C:\Users\Fran\Desktop\cualquiera.exe"),
            process(16, 13, r"E:\SteamLibrary\steamapps\common\Hades\x64\crash.exe"),
            process(17, 1, r"C:\Windows\explorer.exe"),
            process(18, 10, r"C:\Program Files (x86)\Ubisoft\Ubisoft Game Launcher\upc.exe"),
        ];
        let allowed = vec![format!(r"{steam}\steamapps\common\Portal 2")];
        let closed: Vec<u32> = not_allowed(&list, &allowed).iter().map(|process| process.pid).collect();
        // Hades (not his) and what it starts, and a program added to Steam by hand, close; Portal 2 (his), Steam's
        // own programs, its redistributables and Windows stay.
        assert_eq!(closed, vec![13, 15, 16]);
    }

    #[test]
    fn the_week_played_is_most_played_first() {
        let mut file = UsageFile::default();
        file.days.insert("2026-10-31".into(), DayUsage { seconds: 900, games: HashMap::from([("620".into(), 300), ("-2".into(), 600)]) });
        file.days.insert("2026-10-28".into(), DayUsage { seconds: 400, games: HashMap::from([("620".into(), 400)]) });
        file.days.insert("2026-10-01".into(), DayUsage { seconds: 9000, games: HashMap::from([("881100".into(), 9000)]) });
        assert_eq!(recent_games(&file, "2026-10-31", 7), vec![620, -2]);
    }

    #[test]
    fn a_game_limit_lives_inside_the_daily_one() {
        let kid = Kid { daily_minutes: 180, ..Default::default() };
        let roblox = KidGame { app_id: -1, daily_minutes: 60, ..Default::default() };
        let paint = KidGame { app_id: -2, ..Default::default() };
        let mut usage = Usage { seconds: 3000, ..Default::default() };
        usage.games.insert("-1".into(), 3000);
        assert_eq!(left_for(&kid, &roblox, &usage), Some(600));
        assert_eq!(left_for(&kid, &paint, &usage), Some(180 * 60 - 3000));
        usage.games.insert("-1".into(), 3600);
        assert_eq!(left_for(&kid, &roblox, &usage), Some(0));
        // The day's total is the smaller one: it wins over a game's larger own limit.
        usage.seconds = 180 * 60 - 60;
        usage.games.insert("-1".into(), 0);
        assert_eq!(left_for(&kid, &roblox, &usage), Some(60));
        assert_eq!(left_for(&Kid::default(), &paint, &usage), None);
    }
}
