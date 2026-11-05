//! The player's AI connection: a free Ollama Cloud key (Seba, 2026-11-04). The key opens ollama.com/api/chat from
//! this PC; no Ollama install is needed (docs.ollama.com/cloud). Optional: Game Access works the same without it.
//!
//! "Connect AI" (AiConnectWizard.tsx) opens Ollama's key page in the player's own browser, where their Google and GitHub
//! sessions already are (Google refuses to sign in inside an app's window), and a small window of ours that stays on
//! top with the steps and the field for the key (src/aiSteps). The key goes from that window to Rust and nowhere else.
//!
//! The key is kept in one file that Windows protects (DPAPI) for this account, like the parent's key. It never goes
//! to the interface: the interface only learns whether there is one and its last four characters.
use std::{env, fs, io, path::{Path, PathBuf}, sync::atomic::{AtomicBool, Ordering}};
use tauri::{Emitter, Manager};

const STEPS_LABEL: &str = "ai-steps";
/// Whether the steps window got its key, for the event when it closes.
static KEY_KEPT: AtomicBool = AtomicBool::new(false);
const KEYS_PAGE: &str = "https://ollama.com/settings/keys";
const CHAT_URL: &str = "https://ollama.com/api/chat";
const STEPS_WIDTH: f64 = 340.0;
const STEPS_HEIGHT: f64 = 980.0;
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

// DPAPI and the network run off the window's thread.
#[tauri::command]
pub async fn ai_state() -> Result<AiState, String> {
    tauri::async_runtime::spawn_blocking(|| state_at(&store_path()?)).await.map_err(|e| e.to_string())?
}

/// Keeps the key pasted in the steps window, tells the main window ({ ending }) and closes the steps window.
/// "bad_key" when it is not a key: the window stays open.
#[tauri::command]
pub async fn ai_save_key(app: tauri::AppHandle, key: String) -> Result<(), String> {
    let state = tauri::async_runtime::spawn_blocking(move || save_at(&store_path()?, &key)).await.map_err(|e| e.to_string())??;
    KEY_KEPT.store(true, Ordering::SeqCst);
    let _ = app.emit_to("main", "gameaccess:ai-key", serde_json::json!({ "ending": state.ending }));
    if let Some(window) = app.get_webview_window(STEPS_LABEL) { let _ = window.close(); }
    Ok(())
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

fn log(level: &str, message: String) { let _ = crate::activity_log::append_narration_lines(vec![message], "AI".to_string(), level.to_string()); }

/// The start of an answer, for the log. Ollama's answers carry no key.
fn brief(text: &str) -> String { text.chars().take(400).collect() }

/// The JSON in a model's answer: all of it, or the object inside when the model wrapped it in text or a code fence.
fn json_in(content: &str) -> Option<serde_json::Value> {
    if let Ok(value) = serde_json::from_str(content) { return Some(value); }
    let (start, end) = (content.find('{')?, content.rfind('}')?);
    serde_json::from_str(content.get(start..=end)?).ok()
}

/// Longest prompt the app sends: a short list of games and the player's tastes, never the whole catalog.
const MAX_PROMPT: usize = 24_000;

/// Asks Gemma for an answer in a fixed shape: Ollama's `format` takes the JSON schema, so the model answers exactly
/// that JSON (aiSuggestions.ts builds the prompts and checks every answer against what really exists). Same errors as
/// `ai_test`, plus "failed:json" when the answer is not the JSON asked for.
#[tauri::command]
pub async fn ai_chat_json(system: String, prompt: String, schema: serde_json::Value) -> Result<serde_json::Value, String> {
    if system.len() + prompt.len() > MAX_PROMPT { return Err("failed:too_long".into()); }
    tauri::async_runtime::spawn_blocking(move || {
        let key = ollama_key().ok_or("no_key")?;
        let client = reqwest::blocking::Client::builder().timeout(std::time::Duration::from_secs(90)).build().map_err(|e| e.to_string())?;
        let body = serde_json::json!({ "model": TEST_MODEL, "stream": false, "think": false, "format": schema,
            "options": { "temperature": 0.4 },
            "messages": [{ "role": "system", "content": system }, { "role": "user", "content": prompt }] });
        let response = client.post(CHAT_URL).bearer_auth(key).json(&body).send().map_err(|err| {
            log("WARN", format!("Ollama did not answer: {err}"));
            "offline".to_string()
        })?;
        let status = response.status().as_u16();
        let text = response.text().map_err(|err| { log("WARN", format!("Ollama's answer ({status}) could not be read: {err}")); "failed:body".to_string() })?;
        match status {
            200 => {}
            401 | 403 => { log("WARN", format!("Ollama refused the key ({status}): {}", brief(&text))); return Err("rejected".into()); }
            429 => { log("WARN", format!("Ollama's limit ({status}): {}", brief(&text))); return Err("limit".into()); }
            status => { log("ERROR", format!("Ollama answered {status}: {}", brief(&text))); return Err(format!("failed:{status}")); }
        }
        let reply: serde_json::Value = serde_json::from_str(&text).map_err(|_| { log("ERROR", format!("Ollama's answer is not JSON: {}", brief(&text))); "failed:body".to_string() })?;
        let Some(content) = reply["message"]["content"].as_str() else { log("ERROR", format!("Ollama's answer has no content: {}", brief(&text))); return Err("failed:empty".into()); };
        json_in(content).ok_or_else(|| { log("ERROR", format!("{TEST_MODEL} did not answer the JSON asked for: {}", brief(content))); "failed:json".to_string() })
    }).await.map_err(|e| e.to_string())?
}

/// Opens Ollama's key page in the player's browser and the steps window beside it, or brings the steps window back.
/// Events to the main window: `gameaccess:ai-key` when the key was kept ({ ending }) and `gameaccess:ai-guide-closed`
/// when the window closes ({ saved }).
// Async on purpose: a window built inside a synchronous command deadlocks WebView2 on Windows and stays blank.
#[tauri::command]
pub async fn ai_guide_open(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(STEPS_LABEL) { let _ = window.unminimize(); let _ = window.set_focus(); return Ok(()); }
    KEY_KEPT.store(false, Ordering::SeqCst);
    crate::execution_profiles::open_external(KEYS_PAGE)?;
    let window = tauri::WebviewWindowBuilder::new(&app, STEPS_LABEL, tauri::WebviewUrl::App("ai-steps.html".into()))
        .title("Game Access · Conectar IA")
        .inner_size(STEPS_WIDTH, STEPS_HEIGHT)
        .resizable(false)
        .maximizable(false)
        .always_on_top(true)
        .focused(false)
        .build().map_err(|e| e.to_string())?;
    // Against the right edge, where it covers the least of the browser; shorter on a small screen, and it scrolls.
    if let Ok(Some(monitor)) = window.current_monitor() {
        let scale = monitor.scale_factor();
        let area = monitor.work_area();
        let height = STEPS_HEIGHT.min(f64::from(area.size.height) / scale - 48.0);
        let _ = window.set_size(tauri::LogicalSize::new(STEPS_WIDTH, height));
        let width = window.outer_size().map_or(STEPS_WIDTH * scale, |size| f64::from(size.width));
        let _ = window.set_position(tauri::PhysicalPosition::new(area.position.x + area.size.width as i32 - width as i32 - 16, area.position.y + 16));
    }
    let closed_app = app.clone();
    window.on_window_event(move |event| {
        if let tauri::WindowEvent::Destroyed = event {
            let _ = closed_app.emit_to("main", "gameaccess:ai-guide-closed", serde_json::json!({ "saved": KEY_KEPT.load(Ordering::SeqCst) }));
        }
    });
    Ok(())
}

/// Opens Ollama's key page again, when the player closed that tab.
#[tauri::command]
pub fn ai_open_keys_in_browser() -> Result<(), String> { crate::execution_profiles::open_external(KEYS_PAGE) }

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_json_is_found_inside_what_the_model_wrote() {
        assert_eq!(json_in("{\"a\":1}").unwrap()["a"], 1);
        assert_eq!(json_in("```json
{\"a\":1}
```").unwrap()["a"], 1);
        assert_eq!(json_in("Here it is: {\"a\":{\"b\":2}} done").unwrap()["a"]["b"], 2);
        assert!(json_in("no json here").is_none());
        assert!(json_in("{broken").is_none());
    }

    #[test]
    fn keys_must_be_one_clean_token() {
        assert_eq!(clean_key("  abcdef0123456789.XYZ_-  ").unwrap(), "abcdef0123456789.XYZ_-");
        assert!(clean_key("short").is_err());
        assert!(clean_key("abcdef0123456789 with space").is_err());
        assert!(clean_key("abcdef0123456789\nnext").is_err());
    }
}
