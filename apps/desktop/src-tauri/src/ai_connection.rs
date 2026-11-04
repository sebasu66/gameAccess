//! The player's AI connection: a free Ollama Cloud key (Seba, 2026-11-04). The key opens ollama.com/api/chat from
//! this PC; no Ollama install is needed (docs.ollama.com/cloud). Optional: Game Access works the same without it.
//!
//! "Connect AI" (AiConnectWizard.tsx) opens Ollama's key page in a window of our own with a guide over it
//! (ollama_guide.js): it points at what to press to sign up or sign in and to create the key, and takes the key when
//! Ollama shows it. The key reaches Rust through a gameaccess-ai:// navigation that the window stops, so it never
//! leaves the PC and needs no IPC permission for a remote page. Google refuses to sign in inside an app's window:
//! its button is hidden there, and the wizard keeps "open it in my browser" and pasting the key by hand.
//!
//! The key is kept in one file that Windows protects (DPAPI) for this account, like the parent's key. It never goes
//! to the interface: the interface only learns whether there is one and its last four characters.
use std::{env, fs, io, path::{Path, PathBuf}, sync::{atomic::{AtomicBool, Ordering}, Arc}};
use tauri::{Emitter, Manager};

const GUIDE_LABEL: &str = "ai-connect";
const KEYS_PAGE: &str = "https://ollama.com/settings/keys";
const CHAT_URL: &str = "https://ollama.com/api/chat";
/// The model of the connection test: a free cloud model listed by ollama.com/api/tags (2026-11-04).
pub const TEST_MODEL: &str = "gemma4:31b";

#[derive(serde::Serialize, serde::Deserialize, Default)]
struct Stored { ollama_key: Option<String> }

#[derive(serde::Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AiState {
    pub connected: bool,
    /// The key's last four characters, to tell it apart in Ollama's list. Empty without a key.
    pub ending: String,
}

fn store_path() -> Result<PathBuf, String> {
    let base = env::var_os("LOCALAPPDATA").ok_or("Windows application data is unavailable")?;
    Ok(PathBuf::from(base).join("GameAccess").join("ai").join("ollama-key.dpapi"))
}

fn read_at(path: &Path) -> Result<Stored, String> {
    let encrypted = match fs::read(path) {
        Ok(data) => data,
        Err(err) if err.kind() == io::ErrorKind::NotFound => return Ok(Stored::default()),
        Err(err) => return Err(format!("Cannot read the AI key: {err}")),
    };
    let plain = crate::access_activation::windows_protection::unprotect(&encrypted)?;
    serde_json::from_slice(&plain).map_err(|_| "The AI key is damaged".to_string())
}

fn write_at(path: &Path, stored: &Stored) -> Result<(), String> {
    if let Some(dir) = path.parent() { fs::create_dir_all(dir).map_err(|err| format!("Cannot create the folder: {err}"))?; }
    let plain = serde_json::to_vec(stored).map_err(|_| "Cannot encode the AI key".to_string())?;
    let encrypted = crate::access_activation::windows_protection::protect(&plain)?;
    let temp = path.with_extension("tmp");
    fs::write(&temp, encrypted).map_err(|err| format!("Cannot save the AI key: {err}"))?;
    fs::rename(&temp, path).map_err(|err| format!("Cannot save the AI key: {err}"))
}

/// A key as Ollama shows it: one token, no spaces or control characters. Anything else was copied wrong.
fn clean_key(key: &str) -> Result<String, String> {
    let key = key.trim();
    let fits = (16..=256).contains(&key.len()) && key.chars().all(|c| c.is_ascii_graphic());
    if fits { Ok(key.to_string()) } else { Err("bad_key".into()) }
}

fn state_at(path: &Path) -> Result<AiState, String> {
    Ok(match read_at(path)?.ollama_key {
        Some(key) => AiState { connected: true, ending: key.chars().rev().take(4).collect::<Vec<_>>().into_iter().rev().collect() },
        None => AiState { connected: false, ending: String::new() },
    })
}

fn save_at(path: &Path, key: &str) -> Result<AiState, String> {
    write_at(path, &Stored { ollama_key: Some(clean_key(key)?) })?;
    state_at(path)
}

fn clear_at(path: &Path) -> Result<(), String> {
    match fs::remove_file(path) { Ok(()) => Ok(()), Err(err) if err.kind() == io::ErrorKind::NotFound => Ok(()), Err(err) => Err(err.to_string()) }
}

/// The key, for the Rust side that calls Ollama. Never sent to the interface.
pub fn ollama_key() -> Option<String> { store_path().ok().and_then(|path| read_at(&path).ok()).and_then(|stored| stored.ollama_key) }

/// Where the guide window may go: Ollama's pages and the GitHub sign-in it hands over to.
fn guide_may_visit(url: &tauri::Url) -> bool {
    let host = url.host_str().unwrap_or("");
    let under = |domain: &str| host == domain || host.ends_with(&format!(".{domain}"));
    url.scheme() == "https" && (under("ollama.com") || under("github.com") || under("workos.com") || under("authkit.app"))
}

// DPAPI and the network run off the window's thread.
#[tauri::command]
pub async fn ai_state() -> Result<AiState, String> {
    tauri::async_runtime::spawn_blocking(|| state_at(&store_path()?)).await.map_err(|e| e.to_string())?
}

/// Keeps a key pasted by hand (the wizard's fallback).
#[tauri::command]
pub async fn ai_save_key(key: String) -> Result<AiState, String> {
    tauri::async_runtime::spawn_blocking(move || save_at(&store_path()?, &key)).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn ai_disconnect() -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(|| clear_at(&store_path()?)).await.map_err(|e| e.to_string())?
}

/// Asks the free model one word with the kept key. Errors: "no_key", "rejected" (Ollama refused the key), "limit"
/// (the free use ran out), "offline" (no answer) or "failed:<status>".
#[tauri::command]
pub async fn ai_test() -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let key = ollama_key().ok_or("no_key")?;
        let client = reqwest::blocking::Client::builder().timeout(std::time::Duration::from_secs(30)).build().map_err(|e| e.to_string())?;
        let body = serde_json::json!({ "model": TEST_MODEL, "stream": false, "think": false, "options": { "num_predict": 4 },
            "messages": [{ "role": "user", "content": "Reply with: ok" }] });
        let response = client.post(CHAT_URL).bearer_auth(key).json(&body).send().map_err(|_| "offline".to_string())?;
        match response.status().as_u16() {
            200 => Ok(TEST_MODEL.to_string()),
            401 | 403 => Err("rejected".into()),
            429 => Err("limit".into()),
            status => Err(format!("failed:{status}")),
        }
    }).await.map_err(|e| e.to_string())?
}

/// Opens Ollama's key page in a Game Access window with the guide over it. Events to the main window:
/// `gameaccess:ai-key` when the key was kept ({ ending }), `gameaccess:ai-google` when the player chose Google
/// (it does not work here) and `gameaccess:ai-guide-closed` when the window closes ({ saved }).
#[tauri::command]
pub fn ai_guide_open(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(GUIDE_LABEL) { let _ = window.unminimize(); let _ = window.set_focus(); return Ok(()); }
    let saved = Arc::new(AtomicBool::new(false));
    let (nav_app, nav_saved) = (app.clone(), saved.clone());
    let window = tauri::WebviewWindowBuilder::new(&app, GUIDE_LABEL, tauri::WebviewUrl::External(KEYS_PAGE.parse::<tauri::Url>().map_err(|e| e.to_string())?))
        .title("Game Access · Conectar IA")
        .inner_size(1100.0, 820.0)
        .center()
        .initialization_script(include_str!("ollama_guide.js"))
        .on_navigation(move |url| {
            if url.scheme() == "gameaccess-ai" {
                let key = url.query_pairs().find(|(name, _)| name == "k").map(|(_, value)| value.into_owned());
                let (app, saved) = (nav_app.clone(), nav_saved.clone());
                if let Some(key) = key {
                    tauri::async_runtime::spawn(async move {
                        let kept = tauri::async_runtime::spawn_blocking(move || store_path().and_then(|path| save_at(&path, &key))).await;
                        if let Ok(Ok(state)) = kept {
                            saved.store(true, Ordering::SeqCst);
                            let _ = app.emit_to("main", "gameaccess:ai-key", serde_json::json!({ "ending": state.ending }));
                            // A moment to read the guide's "Done" before the window goes.
                            pause(1200).await;
                            if let Some(window) = app.get_webview_window(GUIDE_LABEL) { let _ = window.close(); }
                        }
                    });
                }
                return false;
            }
            if url.host_str() == Some("accounts.google.com") {
                let _ = nav_app.emit_to("main", "gameaccess:ai-google", ());
                return false;
            }
            guide_may_visit(url)
        })
        .build().map_err(|e| e.to_string())?;
    let closed_app = app.clone();
    window.on_window_event(move |event| {
        if let tauri::WindowEvent::Destroyed = event {
            let _ = closed_app.emit_to("main", "gameaccess:ai-guide-closed", serde_json::json!({ "saved": saved.load(Ordering::SeqCst) }));
        }
    });
    Ok(())
}

/// Opens Ollama's key page in the player's own browser (for Google, or when the guide window cannot help).
#[tauri::command]
pub fn ai_open_keys_in_browser() -> Result<(), String> { crate::execution_profiles::open_external(KEYS_PAGE) }

async fn pause(ms: u64) { let _ = tauri::async_runtime::spawn_blocking(move || std::thread::sleep(std::time::Duration::from_millis(ms))).await; }

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keys_must_be_one_clean_token() {
        assert_eq!(clean_key("  abcdef0123456789.XYZ_-  ").unwrap(), "abcdef0123456789.XYZ_-");
        assert!(clean_key("short").is_err());
        assert!(clean_key("abcdef0123456789 with space").is_err());
        assert!(clean_key("abcdef0123456789\nnext").is_err());
    }

    #[test]
    fn the_guide_stays_on_ollama_and_its_sign_in() {
        let ok = |s: &str| guide_may_visit(&s.parse().unwrap());
        assert!(ok("https://ollama.com/settings/keys"));
        assert!(ok("https://signin.ollama.com/sign-up"));
        assert!(ok("https://github.com/login/oauth/authorize"));
        assert!(!ok("http://ollama.com/settings/keys"));
        assert!(!ok("https://ollama.com.evil.example/"));
        assert!(!ok("https://docs.ollama.example/"));
        assert!(!ok("https://accounts.google.com/o/oauth2"));
    }
}
