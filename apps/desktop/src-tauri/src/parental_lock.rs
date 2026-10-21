//! Parental control: the policy and its password, kept together in one file that Windows protects (DPAPI)
//! for this Windows account, so clearing the app's web storage cannot turn the control off.
//!
//! The installer decides whether the control starts on (`HKLM\Software\gameAccess\ParentalDefault`, on unless
//! it is "0"). The password is created in the app, not in the installer: the installer runs as an administrator
//! and DPAPI belongs to the account that opens Game Access. Once a password exists, every change to the policy
//! needs it, and wrong guesses make the next try wait (30 s after the third, doubling up to 5 minutes).
use std::{env, fs, io, path::{Path, PathBuf}};

const MIN_PASSWORD: usize = 4;
const FREE_FAILURES: u32 = 3;
const FIRST_WAIT_SECONDS: i64 = 30;
const MAX_WAIT_SECONDS: i64 = 300;

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ParentalPolicy {
    pub enabled: bool,
    pub level: String,
    pub hide_violence: bool,
}

impl ParentalPolicy {
    fn normalized(mut self) -> Self {
        if !matches!(self.level.as_str(), "off" | "adult-only" | "strict") {
            self.level = "adult-only".into();
        }
        if self.level == "off" {
            self.enabled = false;
        }
        self
    }
}

#[derive(serde::Serialize, serde::Deserialize, Default)]
struct Stored {
    policy: Option<ParentalPolicy>,
    password_hash: Option<String>,
    #[serde(default)]
    failures: u32,
    #[serde(default)]
    locked_until: i64,
}

#[derive(serde::Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ParentalState {
    pub policy: ParentalPolicy,
    pub has_password: bool,
    /// False until the parent has seen the first-run question (created a password or chose "not now").
    pub set_up: bool,
    pub retry_after_seconds: i64,
}

fn store_path() -> Result<PathBuf, String> {
    let base = env::var_os("LOCALAPPDATA").ok_or("Windows application data is unavailable")?;
    Ok(PathBuf::from(base).join("GameAccess").join("parental").join("policy.dpapi"))
}

/// What the installer chose; a build installed without the question (or a development run) starts on.
fn installer_default() -> ParentalPolicy {
    ParentalPolicy { enabled: installer_value().as_deref() != Some("0"), level: "adult-only".into(), hide_violence: false }
}

#[cfg(windows)]
fn installer_value() -> Option<String> {
    use std::os::windows::process::CommandExt;
    let output = std::process::Command::new("reg")
        .args(["query", r"HKLM\Software\gameAccess", "/v", "ParentalDefault", "/reg:64"])
        .creation_flags(0x0800_0000)
        .output().ok()?;
    let text = String::from_utf8_lossy(&output.stdout);
    text.lines().find(|line| line.trim_start().starts_with("ParentalDefault"))?.split_whitespace().last().map(str::to_string)
}

#[cfg(not(windows))]
fn installer_value() -> Option<String> { None }

fn read_at(path: &Path) -> Result<Option<Stored>, String> {
    let encrypted = match fs::read(path) {
        Ok(data) => data,
        Err(err) if err.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(err) => return Err(format!("Cannot read the parental control settings: {err}")),
    };
    let plain = crate::access_activation::windows_protection::unprotect(&encrypted)?;
    serde_json::from_slice(&plain).map(Some).map_err(|_| "The parental control settings are damaged".to_string())
}

fn write_at(path: &Path, stored: &Stored) -> Result<(), String> {
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|err| format!("Cannot create the parental control folder: {err}"))?;
    }
    let plain = serde_json::to_vec(stored).map_err(|_| "Cannot encode the parental control settings".to_string())?;
    let encrypted = crate::access_activation::windows_protection::protect(&plain)?;
    let temp = path.with_extension("tmp");
    fs::write(&temp, encrypted).map_err(|err| format!("Cannot save the parental control settings: {err}"))?;
    fs::rename(&temp, path).map_err(|err| format!("Cannot save the parental control settings: {err}"))
}

fn hash_password(password: &str) -> Result<String, String> {
    use argon2::password_hash::{PasswordHasher, SaltString};
    use rand::RngCore;
    let mut salt = [0u8; 16];
    rand::rngs::OsRng.fill_bytes(&mut salt);
    let salt = SaltString::encode_b64(&salt).map_err(|_| "Cannot create the password".to_string())?;
    argon2::Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .map(|hash| hash.to_string())
        .map_err(|_| "Cannot create the password".to_string())
}

fn password_matches(password: &str, hash: &str) -> bool {
    use argon2::password_hash::{PasswordHash, PasswordVerifier};
    PasswordHash::new(hash).map(|parsed| argon2::Argon2::default().verify_password(password.as_bytes(), &parsed).is_ok()).unwrap_or(false)
}

fn state_of(stored: Option<&Stored>, now: i64) -> ParentalState {
    let policy = stored.and_then(|s| s.policy.clone()).unwrap_or_else(installer_default).normalized();
    ParentalState {
        policy,
        has_password: stored.map(|s| s.password_hash.is_some()).unwrap_or(false),
        set_up: stored.map(|s| s.policy.is_some()).unwrap_or(false),
        retry_after_seconds: stored.map(|s| (s.locked_until - now).max(0)).unwrap_or(0),
    }
}

/// Check the password of a protected policy; a wrong one counts towards the wait (saved at once).
fn authorize(path: &Path, stored: &mut Stored, password: Option<&str>, now: i64) -> Result<(), String> {
    let Some(hash) = stored.password_hash.clone() else { return Ok(()) };
    if stored.locked_until > now {
        return Err(format!("retry_later:{}", stored.locked_until - now));
    }
    if password.map(|p| password_matches(p, &hash)).unwrap_or(false) {
        stored.failures = 0;
        stored.locked_until = 0;
        return Ok(());
    }
    stored.failures += 1;
    if stored.failures >= FREE_FAILURES {
        let doublings = (stored.failures - FREE_FAILURES).min(4);
        stored.locked_until = now + (FIRST_WAIT_SECONDS << doublings).min(MAX_WAIT_SECONDS);
    }
    write_at(path, stored)?;
    Err("wrong_password".into())
}

fn save_at(path: &Path, policy: ParentalPolicy, password: Option<&str>, new_password: Option<&str>, now: i64) -> Result<ParentalState, String> {
    let mut stored = read_at(path)?.unwrap_or_default();
    authorize(path, &mut stored, password, now)?;
    if let Some(new_password) = new_password {
        if new_password.chars().count() < MIN_PASSWORD {
            return Err("password_too_short".into());
        }
        stored.password_hash = Some(hash_password(new_password)?);
    }
    stored.policy = Some(policy.normalized());
    write_at(path, &stored)?;
    Ok(state_of(Some(&stored), now))
}

fn check_at(path: &Path, password: &str, now: i64) -> Result<(), String> {
    let mut stored = read_at(path)?.unwrap_or_default();
    if stored.password_hash.is_none() {
        return Ok(());
    }
    authorize(path, &mut stored, Some(password), now)?;
    write_at(path, &stored)
}

fn now() -> i64 { chrono::Utc::now().timestamp() }

#[tauri::command]
pub fn parental_state() -> Result<ParentalState, String> {
    let path = store_path()?;
    Ok(state_of(read_at(&path)?.as_ref(), now()))
}

/// Save the policy. With a password set, `password` must be it; `new_password` sets or changes it.
#[tauri::command]
pub fn parental_save(policy: ParentalPolicy, password: Option<String>, new_password: Option<String>) -> Result<ParentalState, String> {
    save_at(&store_path()?, policy, password.as_deref(), new_password.as_deref(), now())
}

/// Whether `password` opens the settings (so the panel can be unlocked before any change).
#[tauri::command]
pub fn parental_check(password: String) -> Result<(), String> {
    check_at(&store_path()?, &password, now())
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;

    fn temp_store() -> PathBuf {
        env::temp_dir().join(format!("ga-parental-{}", uuid::Uuid::new_v4())).join("policy.dpapi")
    }

    fn policy(level: &str) -> ParentalPolicy {
        ParentalPolicy { enabled: true, level: level.into(), hide_violence: false }
    }

    #[test]
    fn without_a_file_the_installer_default_applies_and_nothing_is_set_up() {
        let state = state_of(None, 0);
        assert!(!state.has_password && !state.set_up);
        assert_eq!(state.policy.level, "adult-only");
    }

    #[test]
    fn the_password_protects_every_later_change_and_is_never_stored_in_clear() {
        let path = temp_store();
        let state = save_at(&path, policy("strict"), None, Some("abcd1234"), 100).unwrap();
        assert!(state.has_password && state.set_up && state.policy.enabled);
        assert!(!String::from_utf8_lossy(&fs::read(&path).unwrap()).contains("abcd1234"));
        assert_eq!(save_at(&path, policy("off"), None, None, 101).unwrap_err(), "wrong_password");
        assert_eq!(save_at(&path, policy("off"), Some("nope"), None, 102).unwrap_err(), "wrong_password");
        let off = save_at(&path, policy("off"), Some("abcd1234"), None, 103).unwrap();
        assert!(!off.policy.enabled && off.policy.level == "off");
        assert!(check_at(&path, "abcd1234", 104).is_ok());
        fs::remove_dir_all(path.parent().unwrap()).unwrap();
    }

    #[test]
    fn wrong_guesses_make_the_next_try_wait() {
        let path = temp_store();
        save_at(&path, policy("adult-only"), None, Some("secret"), 0).unwrap();
        for _ in 0..3 {
            assert_eq!(check_at(&path, "guess", 10).unwrap_err(), "wrong_password");
        }
        assert_eq!(check_at(&path, "secret", 11).unwrap_err(), "retry_later:29");
        assert_eq!(state_of(read_at(&path).unwrap().as_ref(), 11).retry_after_seconds, 29);
        assert!(check_at(&path, "secret", 41).is_ok());
        fs::remove_dir_all(path.parent().unwrap()).unwrap();
    }

    #[test]
    fn a_short_password_is_refused_and_not_now_is_remembered() {
        let path = temp_store();
        assert_eq!(save_at(&path, policy("adult-only"), None, Some("123"), 0).unwrap_err(), "password_too_short");
        let later = save_at(&path, policy("adult-only"), None, None, 0).unwrap();
        assert!(later.set_up && !later.has_password);
        fs::remove_dir_all(path.parent().unwrap()).unwrap();
    }
}
