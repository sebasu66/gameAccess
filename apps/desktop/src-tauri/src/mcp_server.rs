//! Game Access as an MCP server (Seba, 2026-11-09): the player connects their own AI (Claude, Codex, Cursor...) and
//! asks it for things, such as suggesting new games, making room on the disk or uninstalling a game. It is the installed
//! app itself, not a copy for tests, and it is off until the player turns it on in Settings.
//!
//! This file is only the door: Streamable HTTP on 127.0.0.1 (MCP 2025-06-18, one JSON answer per request, no SSE
//! stream), the access token and the on/off switch. The tools live in the interface (src/mcp), so an AI goes through the
//! same code as the buttons and the screen follows what it does: a `tools/list` or `tools/call` is handed to the window
//! as the "gameaccess:mcp-request" event and waits for its answer (`mcp_reply`).
//!
//! Who can come in: only this PC (127.0.0.1), only with the token (kept in a file Windows protects for this account,
//! like the AI key), and never a web page: a request with an Origin header is refused, so a site open in a browser
//! cannot reach the app even if it guesses the port.
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    env, fs, io,
    io::{Read, Write},
    net::{TcpListener, TcpStream},
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        mpsc, Arc, Mutex, OnceLock,
    },
    thread,
    time::Duration,
};
use tauri::{AppHandle, Emitter};

pub const DEFAULT_PORT: u16 = 38160;
const PROTOCOL_VERSIONS: [&str; 3] = ["2025-06-18", "2025-03-26", "2024-11-05"];
const REQUEST_EVENT: &str = "gameaccess:mcp-request";
/// How long a tool may take in the window. Long work (a download) starts and answers at once; this is for a hung page.
const TOOL_TIMEOUT: Duration = Duration::from_secs(120);
const MAX_BODY: usize = 4 * 1024 * 1024;

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Settings {
    enabled: bool,
    port: u16,
    /// Actions that delete or take a lot of room ask the player in the app first.
    confirm: bool,
}

impl Default for Settings {
    fn default() -> Self { Settings { enabled: false, port: DEFAULT_PORT, confirm: true } }
}

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct McpState {
    pub enabled: bool,
    pub running: bool,
    pub port: u16,
    pub url: String,
    pub confirm: bool,
    /// Why it is on but not running (the port is taken...). Empty when fine.
    pub error: String,
}

struct Running { port: u16, stop: Arc<AtomicBool> }

static APP: OnceLock<AppHandle> = OnceLock::new();
static RUNNING: Mutex<Option<Running>> = Mutex::new(None);
static LAST_ERROR: Mutex<String> = Mutex::new(String::new());
static PENDING: OnceLock<Mutex<HashMap<u64, mpsc::Sender<Result<Value, String>>>>> = OnceLock::new();
static NEXT_ID: AtomicU64 = AtomicU64::new(1);
/// The window listens for requests (it says so once its tools are registered).
static BRIDGE_READY: AtomicBool = AtomicBool::new(false);

fn pending() -> &'static Mutex<HashMap<u64, mpsc::Sender<Result<Value, String>>>> { PENDING.get_or_init(|| Mutex::new(HashMap::new())) }

fn folder() -> Result<PathBuf, String> {
    let base = env::var_os("LOCALAPPDATA").ok_or("Windows application data is unavailable")?;
    Ok(PathBuf::from(base).join("GameAccess").join("mcp"))
}

fn read_settings() -> Settings {
    folder().ok().and_then(|dir| fs::read(dir.join("settings.json")).ok()).and_then(|data| serde_json::from_slice(&data).ok()).unwrap_or_default()
}

fn write_settings(settings: &Settings) -> Result<(), String> {
    let dir = folder()?;
    fs::create_dir_all(&dir).map_err(|err| format!("Cannot create the folder: {err}"))?;
    let data = serde_json::to_vec_pretty(settings).map_err(|err| err.to_string())?;
    let temp = dir.join("settings.tmp");
    fs::write(&temp, data).map_err(|err| format!("Cannot save the MCP settings: {err}"))?;
    fs::rename(&temp, dir.join("settings.json")).map_err(|err| format!("Cannot save the MCP settings: {err}"))
}

/// The access token, made the first time it is needed. Only the settings screen reads it, to set up an AI client.
fn token() -> Result<String, String> {
    let path = folder()?.join("token.dpapi");
    match fs::read(&path) {
        Ok(encrypted) => {
            let plain = crate::access_activation::windows_protection::unprotect(&encrypted)?;
            return String::from_utf8(plain).map_err(|_| "The MCP token is damaged".to_string());
        }
        Err(err) if err.kind() == io::ErrorKind::NotFound => {}
        Err(err) => return Err(format!("Cannot read the MCP token: {err}")),
    }
    new_token()
}

fn new_token() -> Result<String, String> {
    use rand::RngCore;
    let mut bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    let token = bytes.iter().map(|b| format!("{b:02x}")).collect::<String>();
    let dir = folder()?;
    fs::create_dir_all(&dir).map_err(|err| format!("Cannot create the folder: {err}"))?;
    let encrypted = crate::access_activation::windows_protection::protect(token.as_bytes())?;
    let temp = dir.join("token.tmp");
    fs::write(&temp, encrypted).map_err(|err| format!("Cannot save the MCP token: {err}"))?;
    fs::rename(&temp, dir.join("token.dpapi")).map_err(|err| format!("Cannot save the MCP token: {err}"))?;
    Ok(token)
}

fn url_for(port: u16) -> String { format!("http://127.0.0.1:{port}/mcp") }

fn state() -> McpState {
    let settings = read_settings();
    let running = RUNNING.lock().unwrap().as_ref().map(|run| run.port);
    McpState {
        enabled: settings.enabled,
        running: running.is_some(),
        port: running.unwrap_or(settings.port),
        url: url_for(running.unwrap_or(settings.port)),
        confirm: settings.confirm,
        error: if settings.enabled && running.is_none() { LAST_ERROR.lock().unwrap().clone() } else { String::new() },
    }
}

fn start(port: u16) -> Result<(), String> {
    let mut running = RUNNING.lock().unwrap();
    if running.as_ref().is_some_and(|run| run.port == port) { return Ok(()); }
    if let Some(old) = running.take() { old.stop.store(true, Ordering::SeqCst); }
    let token = token()?;
    let listener = TcpListener::bind(("127.0.0.1", port)).map_err(|err| format!("The port {port} is taken: {err}"))?;
    listener.set_nonblocking(true).map_err(|err| err.to_string())?;
    let stop = Arc::new(AtomicBool::new(false));
    let stopped = stop.clone();
    thread::Builder::new().name("gameaccess-mcp".into()).spawn(move || {
        while !stopped.load(Ordering::SeqCst) {
            match listener.accept() {
                Ok((stream, _)) => {
                    let token = token.clone();
                    let _ = thread::Builder::new().name("gameaccess-mcp-request".into()).spawn(move || {
                        if let Err(err) = serve(stream, &token) { eprintln!("Game Access MCP request failed: {err}"); }
                    });
                }
                Err(err) if err.kind() == io::ErrorKind::WouldBlock => thread::sleep(Duration::from_millis(50)),
                Err(err) => { eprintln!("Game Access MCP accept failed: {err}"); thread::sleep(Duration::from_millis(200)); }
            }
        }
    }).map_err(|err| format!("Cannot start the MCP server: {err}"))?;
    *running = Some(Running { port, stop });
    Ok(())
}

fn stop() {
    if let Some(old) = RUNNING.lock().unwrap().take() { old.stop.store(true, Ordering::SeqCst); }
}

/// From main.rs at start: keeps the app's handle and opens the door if the player left it on. A child's account never
/// opens it: the adult's Game Access is the one an AI talks to.
pub fn attach(app: AppHandle) {
    let _ = APP.set(app);
    let settings = read_settings();
    if settings.enabled && crate::kid_mode::kid_account().is_none() {
        if let Err(err) = start(settings.port) { *LAST_ERROR.lock().unwrap() = err; }
    }
}

// ---- HTTP ----

struct Request { method: String, path: String, headers: HashMap<String, String>, body: Vec<u8> }

fn read_request(stream: &mut TcpStream) -> Result<Request, String> {
    stream.set_read_timeout(Some(Duration::from_secs(10))).map_err(|err| err.to_string())?;
    let mut data = Vec::new();
    let mut chunk = [0u8; 8192];
    let head_end = loop {
        let read = stream.read(&mut chunk).map_err(|err| err.to_string())?;
        if read == 0 { return Err("connection closed".into()); }
        data.extend_from_slice(&chunk[..read]);
        if let Some(pos) = data.windows(4).position(|w| w == b"\r\n\r\n") { break pos; }
        if data.len() > 64 * 1024 { return Err("headers too large".into()); }
    };
    let head = String::from_utf8_lossy(&data[..head_end]).to_string();
    let mut lines = head.split("\r\n");
    let mut first = lines.next().unwrap_or_default().split_whitespace();
    let method = first.next().unwrap_or_default().to_string();
    let path = first.next().unwrap_or_default().split('?').next().unwrap_or_default().to_string();
    let headers = lines.filter_map(|line| line.split_once(':')).map(|(k, v)| (k.trim().to_ascii_lowercase(), v.trim().to_string())).collect::<HashMap<_, _>>();
    let length = headers.get("content-length").and_then(|v| v.parse::<usize>().ok()).unwrap_or(0);
    if length > MAX_BODY { return Err("body too large".into()); }
    let mut body = data[head_end + 4..].to_vec();
    while body.len() < length {
        let read = stream.read(&mut chunk).map_err(|err| err.to_string())?;
        if read == 0 { break; }
        body.extend_from_slice(&chunk[..read]);
    }
    body.truncate(length);
    Ok(Request { method, path, headers, body })
}

fn respond(stream: &mut TcpStream, status: u16, reason: &str, body: Option<&Value>) -> Result<(), String> {
    let text = body.map(|value| value.to_string()).unwrap_or_default();
    let mut head = format!("HTTP/1.1 {status} {reason}\r\nConnection: close\r\nContent-Length: {}\r\n", text.len());
    if body.is_some() { head.push_str("Content-Type: application/json\r\n"); }
    if status == 405 { head.push_str("Allow: POST\r\n"); }
    head.push_str("\r\n");
    stream.write_all(head.as_bytes()).and_then(|_| stream.write_all(text.as_bytes())).map_err(|err| err.to_string())
}

fn serve(mut stream: TcpStream, token: &str) -> Result<(), String> {
    // On Windows an accepted socket inherits the listener's non-blocking mode; a request is read and answered in turn.
    stream.set_nonblocking(false).map_err(|err| err.to_string())?;
    let request = read_request(&mut stream)?;
    // A web page always sends Origin; an AI client never does. Refusing it closes the door to sites in a browser.
    if request.headers.contains_key("origin") { return respond(&mut stream, 403, "Forbidden", Some(&json!({ "error": "Web pages cannot use Game Access" }))); }
    if request.path != "/mcp" { return respond(&mut stream, 404, "Not Found", None); }
    let expected = format!("Bearer {token}");
    if request.headers.get("authorization").map(String::as_str) != Some(expected.as_str()) {
        return respond(&mut stream, 401, "Unauthorized", Some(&json!({ "error": "Missing or wrong Game Access token" })));
    }
    // No server-sent stream: every answer comes in the POST's own response (allowed by the Streamable HTTP transport).
    if request.method != "POST" { return respond(&mut stream, 405, "Method Not Allowed", None); }
    let message: Value = match serde_json::from_slice(&request.body) {
        Ok(value) => value,
        Err(_) => return respond(&mut stream, 400, "Bad Request", Some(&rpc_error(Value::Null, -32700, "Parse error"))),
    };
    match handle(&message) {
        Some(answer) => respond(&mut stream, 200, "OK", Some(&answer)),
        None => respond(&mut stream, 202, "Accepted", None),
    }
}

// ---- JSON-RPC ----

fn rpc_error(id: Value, code: i64, message: &str) -> Value { json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } }) }
fn rpc_result(id: Value, result: Value) -> Value { json!({ "jsonrpc": "2.0", "id": id, "result": result }) }

/// The answer to one JSON-RPC message, or None for a notification (it gets 202 Accepted).
fn handle(message: &Value) -> Option<Value> {
    let method = message.get("method").and_then(Value::as_str).unwrap_or_default();
    let id = message.get("id").cloned();
    let Some(id) = id else { return None };
    let params = message.get("params").cloned().unwrap_or(json!({}));
    Some(match method {
        "initialize" => {
            let asked = params.get("protocolVersion").and_then(Value::as_str).unwrap_or_default();
            let version = PROTOCOL_VERSIONS.iter().find(|v| **v == asked).copied().unwrap_or(PROTOCOL_VERSIONS[0]);
            rpc_result(id, json!({
                "protocolVersion": version,
                "capabilities": { "tools": { "listChanged": false } },
                "serverInfo": { "name": "game-access", "title": "Game Access", "version": env!("CARGO_PKG_VERSION") },
                "instructions": "Game Access is the player's game library and catalog on this PC. Use these tools to find games for them, see what is installed and how much room it takes, and manage downloads and installs. Talk to the player in their language. Before deleting or uninstalling anything, say what and why.",
            }))
        }
        "ping" => rpc_result(id, json!({})),
        "tools/list" | "tools/call" => match ask_window(method, params) {
            Ok(result) => rpc_result(id, result),
            Err(err) if method == "tools/call" => rpc_result(id, json!({ "content": [{ "type": "text", "text": err }], "isError": true })),
            Err(err) => rpc_error(id, -32603, &err),
        },
        _ => rpc_error(id, -32601, "Method not found"),
    })
}

fn ask_window(method: &str, params: Value) -> Result<Value, String> {
    let app = APP.get().ok_or("Game Access is still opening")?;
    if !BRIDGE_READY.load(Ordering::SeqCst) { return Err("Game Access is still opening; try again in a few seconds".into()); }
    let id = NEXT_ID.fetch_add(1, Ordering::SeqCst);
    let (sender, receiver) = mpsc::channel();
    pending().lock().unwrap().insert(id, sender);
    // The page rests while a game runs or the window is minimized: wake it so it can answer.
    crate::webview_rest::wake(app);
    if let Err(err) = app.emit(REQUEST_EVENT, json!({ "id": id, "method": method, "params": params })) {
        pending().lock().unwrap().remove(&id);
        return Err(format!("Cannot reach the Game Access window: {err}"));
    }
    let answer = receiver.recv_timeout(TOOL_TIMEOUT);
    pending().lock().unwrap().remove(&id);
    answer.unwrap_or_else(|_| Err("Game Access did not answer in time".into()))
}

// ---- Commands ----

#[tauri::command]
pub fn mcp_state() -> McpState { state() }

/// The settings switch. Turning it on opens the door right away; off closes it.
#[tauri::command]
pub fn mcp_set_enabled(enabled: bool) -> Result<McpState, String> {
    if enabled && crate::kid_mode::kid_account().is_some() { return Err("A child's account cannot turn this on".into()); }
    let mut settings = read_settings();
    settings.enabled = enabled;
    write_settings(&settings)?;
    if enabled {
        match start(settings.port) {
            Ok(()) => LAST_ERROR.lock().unwrap().clear(),
            Err(err) => *LAST_ERROR.lock().unwrap() = err,
        }
    } else {
        stop();
    }
    Ok(state())
}

#[tauri::command]
pub fn mcp_set_confirm(confirm: bool) -> Result<McpState, String> {
    let mut settings = read_settings();
    settings.confirm = confirm;
    write_settings(&settings)?;
    Ok(state())
}

#[derive(Serialize)]
pub struct McpAccess { url: String, token: String }

/// What an AI client needs to connect: for the settings screen, which sets up each client.
#[tauri::command]
pub fn mcp_access() -> Result<McpAccess, String> { Ok(McpAccess { url: state().url, token: token()? }) }

/// A new token: every AI set up before must be set up again.
#[tauri::command]
pub fn mcp_new_token() -> Result<McpAccess, String> {
    let token = new_token()?;
    let port = state().port;
    let was_running = RUNNING.lock().unwrap().is_some();
    if was_running { stop(); start(port)?; }
    Ok(McpAccess { url: url_for(port), token })
}

/// Brings the window to the front, so the player sees what their AI asks to confirm (a delete, a big download).
#[tauri::command]
pub fn mcp_show_window(app: AppHandle) {
    use tauri::Manager;
    crate::webview_rest::wake(&app);
    if let Some(window) = app.get_webview_window("main") { let _ = window.unminimize(); let _ = window.show(); let _ = window.set_focus(); }
}

/// The window's tools are registered (src/mcp/bridge.ts): requests can be handed over.
#[tauri::command]
pub fn mcp_bridge_ready() { BRIDGE_READY.store(true, Ordering::SeqCst); }

/// The window's answer to one request.
#[tauri::command]
pub fn mcp_reply(id: u64, result: Option<Value>, error: Option<String>) {
    if let Some(sender) = pending().lock().unwrap().remove(&id) {
        let _ = sender.send(match error { Some(err) => Err(err), None => Ok(result.unwrap_or(Value::Null)) });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn initialize_answers_with_a_version_it_speaks() {
        let answer = handle(&json!({ "jsonrpc": "2.0", "id": 1, "method": "initialize", "params": { "protocolVersion": "2025-03-26" } })).unwrap();
        assert_eq!(answer["result"]["protocolVersion"], "2025-03-26");
        assert_eq!(answer["result"]["serverInfo"]["name"], "game-access");
        let newer = handle(&json!({ "jsonrpc": "2.0", "id": 2, "method": "initialize", "params": { "protocolVersion": "2099-01-01" } })).unwrap();
        assert_eq!(newer["result"]["protocolVersion"], PROTOCOL_VERSIONS[0]);
    }

    #[test]
    fn notifications_get_no_answer_and_unknown_methods_an_error() {
        assert!(handle(&json!({ "jsonrpc": "2.0", "method": "notifications/initialized" })).is_none());
        let unknown = handle(&json!({ "jsonrpc": "2.0", "id": "x", "method": "resources/list" })).unwrap();
        assert_eq!(unknown["error"]["code"], -32601);
        assert_eq!(unknown["id"], "x");
    }

    #[test]
    fn a_tool_call_before_the_window_is_ready_is_a_tool_error_not_a_crash() {
        let answer = handle(&json!({ "jsonrpc": "2.0", "id": 3, "method": "tools/call", "params": { "name": "library_list" } })).unwrap();
        assert_eq!(answer["result"]["isError"], true);
    }
}
