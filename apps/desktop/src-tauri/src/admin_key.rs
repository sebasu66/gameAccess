//! The parent's key: opens Game Access as the administrator (the gate's field, access_role.ts). Without it the app
//! opens as a player, with fewer privileges (no kid mode, no parental settings).
//!
//! A plain password the parent chooses (Seba, 2026-10-30: the earlier key, the word with the day's date woven in, made
//! the parent do sums in their head every day). Typed in any case. Later the phone app or Windows Hello may stand in
//! for it (vault/Modo niño.md).
//!
//! It is kept in one file that Windows protects (DPAPI) for this account, like the parental control's. The gate only
//! sends what was typed and gets "yes" or "no"; the password goes to the interface only while the parent holds its eye
//! pressed on the parent's key tab (wallet style, `admin_key_word`).
//!
//! The parent's mode is on only once the kid mode wizard is complete (a child in the family file, kid_mode.rs). A word
//! left by an unfinished wizard is asleep: the opening does not ask for it, and the wizard may replace it.
use std::{env, fs, io, path::{Path, PathBuf}};

/// The parent's key as last typed and checked, while Game Access runs: kid mode's service asks for it on every change
/// (restrictor_pipe.rs). Forgotten when Game Access goes back to the player's mode.
static VERIFIED: std::sync::Mutex<Option<String>> = std::sync::Mutex::new(None);
pub fn verified_key() -> Option<String> { VERIFIED.lock().ok().and_then(|value| value.clone()) }
fn remember(key: &str) { if let Ok(mut value) = VERIFIED.lock() { *value = Some(key.trim().to_string()); } }

const MIN_WORD: usize = 4;
const MAX_WORD: usize = 40;

#[derive(serde::Serialize, serde::Deserialize, Default)]
struct Stored { word: Option<String> }

#[derive(serde::Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AdminKeyState {
    pub enabled: bool,
    /// How many characters the password has, so the gate asks only when that many were typed. 0 without a key.
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

/// The password as it is kept: as typed, without spaces around it; no spaces inside (the fields drop them).
fn clean_word(word: &str) -> Result<String, String> {
    let word = word.trim();
    let count = word.chars().count();
    if word.chars().any(char::is_whitespace) || !(MIN_WORD..=MAX_WORD).contains(&count) { return Err("bad_word".into()); }
    Ok(word.to_string())
}

/// Whether `typed` is the password, in any case (a password kept by the earlier version is in capitals).
fn matches(word: &str, typed: &str) -> bool {
    let typed = typed.trim();
    !typed.is_empty() && typed.to_lowercase() == word.to_lowercase()
}

fn state_at(path: &Path, set_up: bool) -> Result<AdminKeyState, String> {
    Ok(match read_at(path)?.word.filter(|_| set_up) {
        Some(word) => AdminKeyState { enabled: true, length: word.chars().count() },
        None => AdminKeyState { enabled: false, length: 0 },
    })
}

fn check_at(path: &Path, attempt: &str) -> Result<bool, String> {
    Ok(read_at(path)?.word.is_some_and(|word| matches(&word, attempt)))
}

/// Whether `current` proves the parent. Without a key set, or with kid mode not set up yet, there is nothing to prove.
fn authorized(path: &Path, current: Option<&str>, set_up: bool) -> Result<bool, String> {
    let Some(word) = read_at(path)?.word.filter(|_| set_up) else { return Ok(true) };
    Ok(matches(&word, current.unwrap_or("")))
}

/// Sets or changes the password. With one already set, `current` must be it.
fn set_at(path: &Path, word: &str, current: Option<&str>, set_up: bool) -> Result<AdminKeyState, String> {
    if !authorized(path, current, set_up)? { return Err("wrong_key".into()); }
    write_at(path, &Stored { word: Some(clean_word(word)?) })?;
    state_at(path, set_up)
}

fn clear_at(path: &Path, current: Option<&str>, set_up: bool) -> Result<(), String> {
    if !authorized(path, current, set_up)? { return Err("wrong_key".into()); }
    match fs::remove_file(path) { Ok(()) => Ok(()), Err(err) if err.kind() == io::ErrorKind::NotFound => Ok(()), Err(err) => Err(err.to_string()) }
}

/// Kid mode was set up: in the new model (restrictor.rs) or with a child's account (kid_mode.rs).
fn set_up() -> bool { crate::restrictor::set_up() || crate::kid_mode::kid_mode_set_up() }

// DPAPI runs off the window's thread, like the parental control's commands.
#[tauri::command]
pub async fn admin_key_state() -> Result<AdminKeyState, String> {
    tauri::async_runtime::spawn_blocking(|| state_at(&store_path()?, set_up())).await.map_err(|e| e.to_string())?
}

/// Whether what was typed is the password. There is no limit on tries: the gate asks on every change once the length fits.
#[tauri::command]
pub async fn admin_key_check(attempt: String) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let ok = check_at(&store_path()?, &attempt)?;
        if ok { remember(&attempt); }
        Ok(ok)
    }).await.map_err(|e| e.to_string())?
}

/// Back to the player's mode: the key is no longer held (ParentModeButton.tsx).
#[tauri::command]
pub fn admin_key_forget() { if let Ok(mut value) = VERIFIED.lock() { *value = None; } }

#[tauri::command]
pub async fn admin_key_set(word: String, current: Option<String>) -> Result<AdminKeyState, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = set_at(&store_path()?, &word, current.as_deref(), set_up())?;
        // Kid mode's service keeps its own copy: it follows, proven by the key it knew.
        let previous = current.clone().or_else(verified_key);
        crate::restrictor_pipe::sync_key(previous.as_deref(), Some(&word));
        remember(&word);
        Ok(state)
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn admin_key_clear(current: Option<String>) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        // From "Remove kid mode", in parent mode: the key verified there proves it.
        let current = current.or_else(verified_key);
        clear_at(&store_path()?, current.as_deref(), set_up())?;
        crate::restrictor_pipe::sync_key(current.as_deref().or(verified_key().as_deref()), None);
        admin_key_forget();
        Ok(())
    }).await.map_err(|e| e.to_string())?
}

/// The password, for the parent's key tab: shown only while its eye is held pressed. That tab is reachable only as
/// the administrator (accessRole.ts).
#[tauri::command]
pub async fn admin_key_word() -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(|| Ok(read_at(&store_path()?)?.word)).await.map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_path() -> PathBuf { env::temp_dir().join(format!("ga-admin-key-{}", uuid::Uuid::new_v4())).join("admin-key.dpapi") }

    #[test]
    fn a_password_is_any_four_to_forty_characters_without_spaces() {
        assert_eq!(clean_word("  Perro2026! "), Ok("Perro2026!".into()));
        assert_eq!(clean_word("niño"), Ok("niño".into()));
        assert!(clean_word("abc").is_err() && clean_word("per ro").is_err() && clean_word(&"a".repeat(41)).is_err());
        assert!(matches("Perro2026!", " perro2026! ") && matches("PERRO", "perro") && !matches("perro", "") && !matches("perro", "perr"));
    }

    #[cfg(windows)]
    #[test]
    fn the_password_is_kept_protected_and_opens_every_day() {
        let path = temp_path();
        assert_eq!(state_at(&path, true).unwrap(), AdminKeyState { enabled: false, length: 0 });
        assert!(!check_at(&path, "perro").unwrap());
        assert_eq!(set_at(&path, "Perro7", None, true).unwrap(), AdminKeyState { enabled: true, length: 6 });
        assert!(!String::from_utf8_lossy(&fs::read(&path).unwrap()).contains("Perro7"));
        assert!(check_at(&path, "Perro7").unwrap() && check_at(&path, " perro7 ").unwrap());
        assert!(!check_at(&path, "Perro8").unwrap());
        // Changing or removing it needs the password.
        assert_eq!(set_at(&path, "gato", None, true), Err("wrong_key".into()));
        assert_eq!(set_at(&path, "gato", Some(""), true), Err("wrong_key".into()));
        assert_eq!(clear_at(&path, Some("nope"), true), Err("wrong_key".into()));
        assert!(set_at(&path, "gatito", Some("perro7"), true).is_ok());
        assert!(clear_at(&path, Some("GATITO"), true).is_ok());
        assert!(!state_at(&path, true).unwrap().enabled);
        let _ = fs::remove_dir_all(path.parent().unwrap());
    }

    #[cfg(windows)]
    #[test]
    fn a_word_kept_by_the_earlier_version_still_opens() {
        // The date key kept the word in capitals; the parent now types the word itself.
        let path = temp_path();
        write_at(&path, &Stored { word: Some("PERRO".into()) }).unwrap();
        assert!(check_at(&path, "perro").unwrap());
        assert_eq!(state_at(&path, true).unwrap(), AdminKeyState { enabled: true, length: 5 });
        let _ = fs::remove_dir_all(path.parent().unwrap());
    }

    #[cfg(windows)]
    #[test]
    fn a_password_without_kid_mode_set_up_is_asleep() {
        // Seba (2026-10-30): an unfinished wizard left a word, and the opening asked for it. It must not.
        let path = temp_path();
        assert!(set_at(&path, "perro", None, false).is_ok());
        assert_eq!(state_at(&path, false).unwrap(), AdminKeyState { enabled: false, length: 0 });
        // The wizard run again may choose another one without knowing the old one.
        assert!(set_at(&path, "gatito", None, false).is_ok());
        // Once kid mode is set up it wakes up and protects itself.
        assert_eq!(state_at(&path, true).unwrap(), AdminKeyState { enabled: true, length: 6 });
        assert_eq!(set_at(&path, "mono", None, true), Err("wrong_key".into()));
        let _ = fs::remove_dir_all(path.parent().unwrap());
    }
}
