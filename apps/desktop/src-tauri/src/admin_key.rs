//! The parent's key: opens Game Access as the administrator (the gate's field, access_role.ts). Without it the app
//! opens as a player, with fewer privileges (no kid mode, no parental settings).
//!
//! It is not one password but a rule only the parent knows. The parent chooses a word; each day's key is that word
//! with the day's date woven in: after each letter, one digit of the date (dd-mm-yy, as six digits), and after the
//! last letter the digits still left. "perro" on 11-11-26 is P1E1R1R1O26. A child who watches it typed learns a key
//! that is already wrong tomorrow. Typed in any case.
//!
//! The word is kept in one file that Windows protects (DPAPI) for this account, like the parental control's. The gate
//! only sends what was typed and gets "yes" or "no". The day's key is never handed to the interface; the word goes
//! there only while the parent holds its eye pressed on the parent's key tab (wallet style, `admin_key_word`).
//!
//! The parent's mode is on only once the kid mode wizard is complete (a child in the family file, kid_mode.rs). A word
//! left by an unfinished wizard is asleep: the opening does not ask for it, and the wizard may replace it.
use chrono::{Datelike, Local, NaiveDate};
use std::{env, fs, io, path::{Path, PathBuf}};

const MIN_WORD: usize = 3;
const MAX_WORD: usize = 20;

#[derive(serde::Serialize, serde::Deserialize, Default)]
struct Stored { word: Option<String> }

#[derive(serde::Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AdminKeyState {
    pub enabled: bool,
    /// How many characters today's key has, so the gate asks only when that many were typed (the word's length plus
    /// the six digits of the date). 0 without a key.
    pub length: usize,
}

fn store_path() -> Result<PathBuf, String> {
    let base = env::var_os("LOCALAPPDATA").ok_or("Windows application data is unavailable")?;
    Ok(PathBuf::from(base).join("GameAccess").join("parental").join("admin-key.dpapi"))
}

fn read_at(path: &Path) -> Result<Stored, String> {
    let encrypted = match fs::read(path) {
        Ok(data) => data,
        Err(err) if err.kind() == io::ErrorKind::NotFound => return Ok(Stored::default()),
        Err(err) => return Err(format!("Cannot read the parent's key: {err}")),
    };
    let plain = crate::access_activation::windows_protection::unprotect(&encrypted)?;
    serde_json::from_slice(&plain).map_err(|_| "The parent's key is damaged".to_string())
}

fn write_at(path: &Path, stored: &Stored) -> Result<(), String> {
    if let Some(dir) = path.parent() { fs::create_dir_all(dir).map_err(|err| format!("Cannot create the folder: {err}"))?; }
    let plain = serde_json::to_vec(stored).map_err(|_| "Cannot encode the parent's key".to_string())?;
    let encrypted = crate::access_activation::windows_protection::protect(&plain)?;
    let temp = path.with_extension("tmp");
    fs::write(&temp, encrypted).map_err(|err| format!("Cannot save the parent's key: {err}"))?;
    fs::rename(&temp, path).map_err(|err| format!("Cannot save the parent's key: {err}"))
}

/// The word as it is kept: letters only, in capitals.
fn clean_word(word: &str) -> Result<String, String> {
    let word = word.trim();
    let count = word.chars().count();
    if !word.chars().all(char::is_alphabetic) || !(MIN_WORD..=MAX_WORD).contains(&count) { return Err("bad_word".into()); }
    Ok(word.to_uppercase())
}

/// The key of `date` for `word` (already clean): a digit of dd-mm-yy after each letter, the rest after the last one.
fn key_for(word: &str, date: NaiveDate) -> String {
    let digits: Vec<char> = format!("{:02}{:02}{:02}", date.day(), date.month(), date.year().rem_euclid(100)).chars().collect();
    let letters: Vec<char> = word.chars().collect();
    let mut key = String::new();
    for (index, letter) in letters.iter().enumerate() {
        key.push(*letter);
        if index + 1 < letters.len() { if let Some(digit) = digits.get(index) { key.push(*digit); } }
        else { key.extend(digits.iter().skip(index)); }
    }
    key
}

fn today() -> NaiveDate { Local::now().date_naive() }

fn state_at(path: &Path, date: NaiveDate, set_up: bool) -> Result<AdminKeyState, String> {
    Ok(match read_at(path)?.word.filter(|_| set_up) {
        Some(word) => AdminKeyState { enabled: true, length: key_for(&word, date).chars().count() },
        None => AdminKeyState { enabled: false, length: 0 },
    })
}

fn check_at(path: &Path, attempt: &str, date: NaiveDate) -> Result<bool, String> {
    Ok(read_at(path)?.word.is_some_and(|word| key_for(&word, date) == attempt.trim().to_uppercase()))
}

/// Whether `current` proves the parent: the word itself or today's key (a parent who is not technical may only
/// remember the word). Without a key set, or with kid mode not set up yet, there is nothing to prove.
fn authorized(path: &Path, current: Option<&str>, date: NaiveDate, set_up: bool) -> Result<bool, String> {
    let Some(word) = read_at(path)?.word.filter(|_| set_up) else { return Ok(true) };
    let typed = current.unwrap_or("").trim().to_uppercase();
    Ok(!typed.is_empty() && (typed == word || typed == key_for(&word, date)))
}

/// Sets or changes the word. With a key already set, `current` must be the word or today's key.
fn set_at(path: &Path, word: &str, current: Option<&str>, date: NaiveDate, set_up: bool) -> Result<AdminKeyState, String> {
    if !authorized(path, current, date, set_up)? { return Err("wrong_key".into()); }
    write_at(path, &Stored { word: Some(clean_word(word)?) })?;
    state_at(path, date, set_up)
}

fn clear_at(path: &Path, current: Option<&str>, date: NaiveDate, set_up: bool) -> Result<(), String> {
    if !authorized(path, current, date, set_up)? { return Err("wrong_key".into()); }
    match fs::remove_file(path) { Ok(()) => Ok(()), Err(err) if err.kind() == io::ErrorKind::NotFound => Ok(()), Err(err) => Err(err.to_string()) }
}

// DPAPI runs off the window's thread, like the parental control's commands.
#[tauri::command]
pub async fn admin_key_state() -> Result<AdminKeyState, String> {
    tauri::async_runtime::spawn_blocking(|| state_at(&store_path()?, today(), crate::kid_mode::kid_mode_set_up())).await.map_err(|e| e.to_string())?
}

/// Whether what was typed is today's key. There is no limit on tries: the gate asks on every change once the length fits.
#[tauri::command]
pub async fn admin_key_check(attempt: String) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || check_at(&store_path()?, &attempt, today())).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn admin_key_set(word: String, current: Option<String>) -> Result<AdminKeyState, String> {
    tauri::async_runtime::spawn_blocking(move || set_at(&store_path()?, &word, current.as_deref(), today(), crate::kid_mode::kid_mode_set_up())).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn admin_key_clear(current: Option<String>) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || clear_at(&store_path()?, current.as_deref(), today(), crate::kid_mode::kid_mode_set_up())).await.map_err(|e| e.to_string())?
}

/// The word, for the parent's key tab: shown only while its eye is held pressed. That tab is reachable only as the
/// administrator (accessRole.ts); the day's key itself is never returned.
#[tauri::command]
pub async fn admin_key_word() -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(|| Ok(read_at(&store_path()?)?.word)).await.map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn day(year: i32, month: u32, date: u32) -> NaiveDate { NaiveDate::from_ymd_opt(year, month, date).unwrap() }

    #[test]
    fn the_key_weaves_the_date_into_the_word() {
        // Seba's example: perro on 11-11-26.
        assert_eq!(key_for("PERRO", day(2026, 11, 11)), "P1E1R1R1O26");
        // Days and months below ten keep their zero, so the key is always the word plus six digits.
        assert_eq!(key_for("PERRO", day(2026, 3, 5)), "P0E5R0R3O26");
        // A short word takes the rest of the date after its last letter; a long one runs out of digits.
        assert_eq!(key_for("SOL", day(2026, 11, 12)), "S1O2L1126");
        assert_eq!(key_for("ELEFANTES", day(2026, 11, 12)), "E1L2E1F1A2N6TES");
        assert_eq!(key_for("PERRO", day(2026, 11, 11)).chars().count(), 5 + 6);
        // It changes every day.
        assert_ne!(key_for("PERRO", day(2026, 11, 11)), key_for("PERRO", day(2026, 11, 12)));
    }

    #[test]
    fn only_a_clean_word_is_kept() {
        assert_eq!(clean_word("  perro "), Ok("PERRO".into()));
        assert_eq!(clean_word("niño"), Ok("NIÑO".into()));
        assert!(clean_word("ab").is_err() && clean_word("per ro").is_err() && clean_word("perro1").is_err() && clean_word(&"a".repeat(21)).is_err());
    }

    #[cfg(windows)]
    #[test]
    fn the_word_is_kept_protected_and_only_todays_key_opens() {
        let path = env::temp_dir().join(format!("ga-admin-key-{}", uuid::Uuid::new_v4())).join("admin-key.dpapi");
        let date = day(2026, 11, 11);
        assert_eq!(state_at(&path, date, true).unwrap(), AdminKeyState { enabled: false, length: 0 });
        assert!(!check_at(&path, "P1E1R1R1O26", date).unwrap());
        assert_eq!(set_at(&path, "perro", None, date, true).unwrap(), AdminKeyState { enabled: true, length: 11 });
        assert!(!String::from_utf8_lossy(&fs::read(&path).unwrap()).contains("PERRO"));
        assert!(check_at(&path, "P1E1R1R1O26", date).unwrap());
        assert!(check_at(&path, " p1e1r1r1o26 ", date).unwrap());
        assert!(!check_at(&path, "P1E1R1R1O27", date).unwrap());
        // Yesterday's key is no good today.
        assert!(!check_at(&path, "P1E1R1R1O26", day(2026, 11, 12)).unwrap());
        // Changing or removing it needs today's key or the word itself; yesterday's key is no good.
        assert_eq!(set_at(&path, "gato", None, date, true), Err("wrong_key".into()));
        assert_eq!(set_at(&path, "gato", Some(""), date, true), Err("wrong_key".into()));
        assert_eq!(clear_at(&path, Some("nope"), date, true), Err("wrong_key".into()));
        assert_eq!(clear_at(&path, Some("P1E1R1R1O26"), day(2026, 11, 12), true), Err("wrong_key".into()));
        assert!(set_at(&path, "gato", Some("P1E1R1R1O26"), date, true).is_ok());
        assert!(set_at(&path, "mono", Some(" gato "), date, true).is_ok());
        assert!(clear_at(&path, Some("M1O1N1O126"), date, true).is_ok());
        assert!(!state_at(&path, date, true).unwrap().enabled);
        let _ = fs::remove_dir_all(path.parent().unwrap());
    }

    #[cfg(windows)]
    #[test]
    fn a_word_without_kid_mode_set_up_is_asleep() {
        // Seba (2026-10-30): an unfinished wizard left a word, and the opening asked for it. It must not.
        let path = env::temp_dir().join(format!("ga-admin-key-{}", uuid::Uuid::new_v4())).join("admin-key.dpapi");
        let date = day(2026, 11, 11);
        assert!(set_at(&path, "perro", None, date, false).is_ok());
        assert_eq!(state_at(&path, date, false).unwrap(), AdminKeyState { enabled: false, length: 0 });
        // The wizard run again may choose another word without knowing the old one.
        assert!(set_at(&path, "gato", None, date, false).is_ok());
        // Once kid mode is set up the word wakes up and protects itself.
        assert_eq!(state_at(&path, date, true).unwrap(), AdminKeyState { enabled: true, length: 10 });
        assert_eq!(set_at(&path, "mono", None, date, true), Err("wrong_key".into()));
        let _ = fs::remove_dir_all(path.parent().unwrap());
    }
}
