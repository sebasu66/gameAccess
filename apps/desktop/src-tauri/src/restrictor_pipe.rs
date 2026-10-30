//! The restrictor owns its settings (Seba, 2026-10-30: editing `config.json` with Notepad turned kid mode off). Its
//! folder is read-only for users; the parent's Game Access asks the service for every change through a local pipe,
//! and the service checks the parent's key against its own copy (an argon2 hash in `restriccion\privado`, which only
//! SYSTEM and administrators can read). The first key it is given becomes its copy (setting kid mode up); changing the
//! key needs the current one. Leaving the pause (parent mode) needs no key: it only makes kid mode stricter.
//!
//! One request per connection, one JSON line each way. A development build without the service installed writes the
//! files itself, as before.

use serde_json::{json, Value};
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};

pub const PIPE_NAME: &str = r"\\.\pipe\GameAccessRestrictor";
/// The pipe in use: `PIPE_NAME`, or another one for a test (so it never talks to an installed service).
fn pipe_name() -> String { std::env::var("GAMEACCESS_RESTRICTION_PIPE").unwrap_or_else(|_| PIPE_NAME.to_string()) }
/// How long one word from the parent's Game Access keeps kid mode paused (it says it every 30 s in parent mode).
pub const PARENT_FRESH_MS: u64 = 60_000;
/// Until when the parent is present (ms since 1970), as the service was told; 0 when not.
pub static PARENT_UNTIL: AtomicU64 = AtomicU64::new(0);
/// Running as the real service (SYSTEM): only then are the folder's permissions narrowed (`lock_down`). A console run or
/// a test would lock its own user out of a folder it needs.
pub static AS_SERVICE: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

fn private_dir() -> PathBuf { crate::restrictor::dir().join("privado") }
fn key_path() -> PathBuf { private_dir().join("clave.txt") }

fn hash(key: &str) -> Result<String, String> {
    use argon2::password_hash::{PasswordHasher, SaltString};
    use rand::RngCore;
    let mut salt = [0u8; 16];
    rand::rngs::OsRng.fill_bytes(&mut salt);
    let salt = SaltString::encode_b64(&salt).map_err(|_| "hash".to_string())?;
    argon2::Argon2::default().hash_password(key.trim().to_lowercase().as_bytes(), &salt).map(|value| value.to_string()).map_err(|_| "hash".to_string())
}

fn matches(key: &str, stored: &str) -> bool {
    use argon2::password_hash::{PasswordHash, PasswordVerifier};
    PasswordHash::new(stored).map(|parsed| argon2::Argon2::default().verify_password(key.trim().to_lowercase().as_bytes(), &parsed).is_ok()).unwrap_or(false)
}

fn stored_key() -> Option<String> { std::fs::read_to_string(key_path()).ok().map(|text| text.trim().to_string()).filter(|text| !text.is_empty()) }

fn store_key(key: &str) -> Result<(), String> {
    std::fs::create_dir_all(private_dir()).map_err(|error| error.to_string())?;
    if AS_SERVICE.load(Ordering::SeqCst) { lock_down(); }
    std::fs::write(key_path(), hash(key)?).map_err(|error| error.to_string())
}

/// The parent's key proves the request; with no copy yet (kid mode not set up) the first one given becomes the copy.
fn proven(key: &str, first_sets_it: bool) -> Result<(), String> {
    // No copy and no key: the parent's key was removed (or never set), there is nothing to protect.
    if key.trim().is_empty() { return if stored_key().is_none() { Ok(()) } else { Err("needs_key".into()) }; }
    match stored_key() {
        Some(stored) if matches(key, &stored) => Ok(()),
        Some(_) => Err("wrong_key".into()),
        None if first_sets_it => store_key(key),
        None => Ok(()),
    }
}

/// The settings folder: SYSTEM and administrators change it, users only read it; its private part users cannot read.
/// Done at every start of the service too, so an older install (users could write) is closed by itself.
pub fn lock_down() {
    let folder = crate::restrictor::dir();
    let _ = std::fs::create_dir_all(&folder);
    let run = |args: Vec<String>| {
        let mut command = std::process::Command::new("icacls");
        command.args(args);
        #[cfg(windows)]
        { use std::os::windows::process::CommandExt; command.creation_flags(0x0800_0000); }
        let _ = command.output();
    };
    // The folder gets its own permissions, and what is inside inherits them (`/reset`). Applying the folder's grants to
    // each file instead (`/T`) left the files with none: users could not read the notice (Seba, 2026-10-30).
    let narrow = |target: &PathBuf, grants: &[&str]| {
        let mut args = vec![target.display().to_string(), "/inheritance:r".into(), "/grant:r".into()];
        args.extend(grants.iter().map(|grant| grant.to_string()));
        args.push("/Q".into());
        run(args);
        run(vec![target.join("*").display().to_string(), "/reset".into(), "/T".into(), "/Q".into()]);
    };
    narrow(&folder, &["*S-1-5-18:(OI)(CI)F", "*S-1-5-32-544:(OI)(CI)F", "*S-1-5-32-545:(OI)(CI)RX"]);
    if private_dir().is_dir() { narrow(&private_dir(), &["*S-1-5-18:(OI)(CI)F", "*S-1-5-32-544:(OI)(CI)F"]); }
}

/// What the service does with one request.
pub fn handle(request: &Value) -> Value {
    let key = request.get("key").and_then(Value::as_str).unwrap_or("");
    let result: Result<Value, String> = match request.get("op").and_then(Value::as_str).unwrap_or("") {
        "save" => proven(key, true).and_then(|_| {
            let config: crate::restrictor::Restriction = serde_json::from_value(request.get("config").cloned().unwrap_or(Value::Null)).map_err(|_| "bad_config".to_string())?;
            crate::restrictor::write_config(&config).map(|_| json!({}))
        }),
        // Kid mode removed: its settings, what was closed and the service's copy of the key go; nothing is closed any more.
        "allow" => proven(key, false).and_then(|_| {
            let path = request.get("path").and_then(Value::as_str).unwrap_or("");
            crate::restrictor::allow_program(path).map(|_| json!({}))
        }),
        "clear" => proven(key, false).and_then(|_| {
            crate::restrictor::remove_settings()?;
            PARENT_UNTIL.store(0, Ordering::SeqCst);
            match std::fs::remove_file(key_path()) { Err(error) if error.kind() != std::io::ErrorKind::NotFound => Err(error.to_string()), _ => Ok(json!({})) }
        }),
        "parent" => {
            let present = request.get("present").and_then(Value::as_bool).unwrap_or(false);
            if present { proven(key, false).map(|_| { PARENT_UNTIL.store(crate::restrictor::now_ms() + PARENT_FRESH_MS, Ordering::SeqCst); json!({}) }) }
            else { PARENT_UNTIL.store(0, Ordering::SeqCst); Ok(json!({})) }
        }
        // The parent changed the key in Game Access: the service's copy follows (the current one proves it).
        "set_key" => {
            let new = request.get("new").and_then(Value::as_str).unwrap_or("");
            proven(key, false).and_then(|_| if new.trim().is_empty() { std::fs::remove_file(key_path()).or(Ok::<(), std::io::Error>(())).map_err(|e| e.to_string()) } else { store_key(new) }).map(|_| json!({}))
        }
        _ => Err("bad_request".into()),
    };
    match result { Ok(value) => json!({ "ok": true, "result": value }), Err(error) => json!({ "ok": false, "error": error }) }
}

// -- the service's end ------------------------------------------------------------------------------------------------

#[cfg(windows)]
#[allow(non_snake_case, clippy::upper_case_acronyms)]
mod win {
    use std::ffi::c_void;
    pub type HANDLE = *mut c_void;
    #[repr(C)]
    pub struct SECURITY_ATTRIBUTES { pub nLength: u32, pub lpSecurityDescriptor: *mut c_void, pub bInheritHandle: i32 }
    #[link(name = "kernel32", kind = "raw-dylib")]
    extern "system" {
        pub fn CreateNamedPipeW(name: *const u16, open: u32, mode: u32, instances: u32, out: u32, inp: u32, timeout: u32, sa: *mut SECURITY_ATTRIBUTES) -> HANDLE;
        pub fn ConnectNamedPipe(pipe: HANDLE, overlapped: *mut c_void) -> i32;
        pub fn DisconnectNamedPipe(pipe: HANDLE) -> i32;
        pub fn ReadFile(file: HANDLE, buffer: *mut u8, size: u32, read: *mut u32, overlapped: *mut c_void) -> i32;
        pub fn WriteFile(file: HANDLE, buffer: *const u8, size: u32, written: *mut u32, overlapped: *mut c_void) -> i32;
        pub fn FlushFileBuffers(file: HANDLE) -> i32;
        pub fn CloseHandle(handle: HANDLE) -> i32;
        pub fn GetLastError() -> u32;
        pub fn LocalFree(memory: *mut c_void) -> *mut c_void;
    }
    #[link(name = "advapi32", kind = "raw-dylib")]
    extern "system" {
        pub fn ConvertStringSecurityDescriptorToSecurityDescriptorW(sddl: *const u16, revision: u32, descriptor: *mut *mut c_void, size: *mut u32) -> i32;
    }
    pub const PIPE_ACCESS_DUPLEX: u32 = 3;
    pub const PIPE_WAIT: u32 = 0;
    pub const PIPE_UNLIMITED_INSTANCES: u32 = 255;
    pub const ERROR_PIPE_CONNECTED: u32 = 535;
    pub const INVALID_HANDLE_VALUE: HANDLE = -1isize as HANDLE;
    pub fn wide(text: &str) -> Vec<u16> { text.encode_utf16().chain(std::iter::once(0)).collect() }
}

/// Answers the parent's Game Access, one request at a time, for as long as the service runs. Users may connect (the
/// key is what proves the parent); SYSTEM and administrators fully.
#[cfg(windows)]
pub fn serve() {
    use win::*;
    let name = wide(&pipe_name());
    let sddl = wide("D:(A;;GA;;;SY)(A;;GA;;;BA)(A;;GRGW;;;BU)");
    let mut descriptor: *mut std::ffi::c_void = std::ptr::null_mut();
    if unsafe { ConvertStringSecurityDescriptorToSecurityDescriptorW(sddl.as_ptr(), 1, &mut descriptor, std::ptr::null_mut()) } == 0 { return; }
    let mut attributes = SECURITY_ATTRIBUTES { nLength: std::mem::size_of::<SECURITY_ATTRIBUTES>() as u32, lpSecurityDescriptor: descriptor, bInheritHandle: 0 };
    while !crate::restrictor::STOP.load(Ordering::SeqCst) {
        let pipe = unsafe { CreateNamedPipeW(name.as_ptr(), PIPE_ACCESS_DUPLEX, PIPE_WAIT, PIPE_UNLIMITED_INSTANCES, 65536, 65536, 0, &mut attributes) };
        if pipe == INVALID_HANDLE_VALUE { std::thread::sleep(std::time::Duration::from_secs(1)); continue; }
        let connected = unsafe { ConnectNamedPipe(pipe, std::ptr::null_mut()) } != 0 || unsafe { GetLastError() } == ERROR_PIPE_CONNECTED;
        if connected {
            let mut data = Vec::new();
            let mut buffer = [0u8; 8192];
            loop {
                let mut read = 0u32;
                if unsafe { ReadFile(pipe, buffer.as_mut_ptr(), buffer.len() as u32, &mut read, std::ptr::null_mut()) } == 0 || read == 0 { break; }
                data.extend_from_slice(&buffer[..read as usize]);
                if data.contains(&b'\n') || data.len() > 1_000_000 { break; }
            }
            let request: Value = serde_json::from_slice(data.split(|byte| *byte == b'\n').next().unwrap_or(&[])).unwrap_or(Value::Null);
            let answer = format!("{}\n", handle(&request));
            let mut written = 0u32;
            unsafe { WriteFile(pipe, answer.as_ptr(), answer.len() as u32, &mut written, std::ptr::null_mut()); FlushFileBuffers(pipe); DisconnectNamedPipe(pipe); }
        }
        unsafe { CloseHandle(pipe); }
    }
    unsafe { LocalFree(descriptor); }
}
#[cfg(not(windows))]
pub fn serve() {}

// -- Game Access's end ------------------------------------------------------------------------------------------------

/// Sends one request to the service and returns its answer's `result`, or its error code. "service_missing" when no
/// service answers (an installer older than this, or a development build).
pub fn ask(request: &Value) -> Result<Value, String> {
    let mut pipe = std::fs::OpenOptions::new().read(true).write(true).open(pipe_name()).map_err(|_| "service_missing".to_string())?;
    pipe.write_all(format!("{request}\n").as_bytes()).map_err(|_| "service_missing".to_string())?;
    let mut line = String::new();
    BufReader::new(pipe).read_line(&mut line).map_err(|_| "service_missing".to_string())?;
    let answer: Value = serde_json::from_str(&line).map_err(|_| "service_missing".to_string())?;
    if answer.get("ok").and_then(Value::as_bool) == Some(true) { Ok(answer.get("result").cloned().unwrap_or(Value::Null)) }
    else { Err(answer.get("error").and_then(Value::as_str).unwrap_or("failed").to_string()) }
}

/// The parent's key changed in Game Access (admin_key.rs): the service's copy follows. `current` proves it; best
/// effort: without the service there is nothing to follow.
pub fn sync_key(current: Option<&str>, new: Option<&str>) {
    let _ = ask(&json!({ "op": "set_key", "key": current.unwrap_or(""), "new": new.unwrap_or("") }));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_key_is_kept_hashed_and_checked_in_any_case() {
        let stored = hash("Perro7").unwrap();
        assert!(!stored.contains("Perro7") && !stored.to_lowercase().contains("perro7"));
        assert!(matches("perro7", &stored) && matches(" PERRO7 ", &stored) && !matches("gato", &stored));
    }

    #[cfg(windows)]
    #[test]
    fn the_service_takes_changes_only_with_the_parents_key() {
        let _env = crate::restrictor::TEST_ENV.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        let root = std::env::temp_dir().join(format!("ga-pipe-{}", uuid::Uuid::new_v4()));
        std::env::set_var("GAMEACCESS_RESTRICTION_DIR", &root);
        std::env::set_var("GAMEACCESS_RESTRICTION_PIPE", format!(r"\\.\pipe\ga-test-{}", uuid::Uuid::new_v4()));
        std::thread::spawn(serve);
        std::thread::sleep(std::time::Duration::from_millis(300));
        let config = json!({ "version": 1, "enabled": true, "kid": { "name": "Fran" } });
        // Setting kid mode up: the first key becomes the service's copy.
        assert_eq!(ask(&json!({ "op": "save", "key": "Perro7", "config": config })).map(|_| ()), Ok(()));
        assert!(crate::restrictor::read_config().is_some_and(|saved| saved.enabled));
        // A wrong key changes nothing; the right one, in any case, does.
        assert_eq!(ask(&json!({ "op": "save", "key": "gato", "config": { "version": 1, "enabled": false } })), Err("wrong_key".to_string()));
        assert!(crate::restrictor::read_config().is_some_and(|saved| saved.enabled));
        assert_eq!(ask(&json!({ "op": "parent", "key": "", "present": true })), Err("needs_key".to_string()));
        assert!(ask(&json!({ "op": "parent", "key": "perro7", "present": true })).is_ok());
        // The key changes: the old one stops working.
        assert!(ask(&json!({ "op": "set_key", "key": "perro7", "new": "Gatito9" })).is_ok());
        assert_eq!(ask(&json!({ "op": "clear", "key": "perro7" })), Err("wrong_key".to_string()));
        assert!(ask(&json!({ "op": "clear", "key": "gatito9" })).is_ok());
        assert!(crate::restrictor::read_config().is_none());
        // The pause it asked for lives in this process's memory: other tests must not see it.
        PARENT_UNTIL.store(0, Ordering::SeqCst);
        std::env::remove_var("GAMEACCESS_RESTRICTION_PIPE");
        std::env::remove_var("GAMEACCESS_RESTRICTION_DIR");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn unknown_requests_are_refused() {
        assert_eq!(handle(&json!({ "op": "erase_everything" }))["ok"], false);
        // Leaving the pause needs no key: it only makes kid mode stricter.
        assert_eq!(handle(&json!({ "op": "parent", "present": false }))["ok"], true);
    }
}
