//! Setting up the player's AI apps to talk to Game Access (Settings › AI control, McpSettings.tsx).
//!
//! Every client starts `gameaccess-desktop.exe --mcp-stdio` (the stdio bridge, `run_stdio_bridge`): it forwards each
//! message to the open app's door (mcp_server.rs) with the token it reads itself, so no client's config file ever holds
//! the token, and the same entry keeps working after a new token. Claude Desktop only speaks stdio; the others would
//! take an address too, but one way for all is simpler to explain and to undo.
//!
//! Writing a client's file keeps everything else in it; the first time, the old file is kept beside it as `.bak`.
use serde::Serialize;
use serde_json::{json, Value};
use std::{
    env, fs,
    io::{BufRead, Write},
    path::{Path, PathBuf},
    time::Duration,
};

pub const SERVER_NAME: &str = "game-access";

#[derive(Clone, Copy, PartialEq, Debug)]
enum Format {
    /// `{ "<key>": { "game-access": {...} } }`
    Json(&'static str),
    /// `[mcp_servers.game-access]` in TOML (Codex).
    CodexToml,
}

struct Client {
    id: &'static str,
    name: &'static str,
    format: Format,
    /// Whether the entry carries `"type": "stdio"` (VS Code and Claude Code want it).
    typed: bool,
}

const CLIENTS: [Client; 6] = [
    Client { id: "claude-desktop", name: "Claude Desktop", format: Format::Json("mcpServers"), typed: false },
    Client { id: "claude-code", name: "Claude Code", format: Format::Json("mcpServers"), typed: true },
    Client { id: "codex", name: "Codex", format: Format::CodexToml, typed: false },
    Client { id: "cursor", name: "Cursor", format: Format::Json("mcpServers"), typed: false },
    Client { id: "vscode", name: "VS Code (Copilot)", format: Format::Json("servers"), typed: true },
    Client { id: "gemini", name: "Gemini CLI", format: Format::Json("mcpServers"), typed: false },
];

fn home() -> Option<PathBuf> { env::var_os("USERPROFILE").map(PathBuf::from) }
fn roaming() -> Option<PathBuf> { env::var_os("APPDATA").map(PathBuf::from) }

/// Claude Desktop from the Microsoft Store keeps its settings inside its package folder.
fn claude_desktop_dir() -> Option<PathBuf> {
    let packages = env::var_os("LOCALAPPDATA").map(|dir| PathBuf::from(dir).join("Packages"));
    if let Some(store) = packages.and_then(|dir| fs::read_dir(dir).ok()).and_then(|entries| {
        entries.flatten().map(|entry| entry.path()).find(|path| path.file_name().and_then(|n| n.to_str()).is_some_and(|n| n.starts_with("Claude_")))
    }) {
        let dir = store.join("LocalCache").join("Roaming").join("Claude");
        if dir.is_dir() { return Some(dir); }
    }
    roaming().map(|dir| dir.join("Claude"))
}

/// The client's config file, and the folder whose presence says the client is on this PC.
fn paths(client: &Client) -> Option<(PathBuf, PathBuf)> {
    Some(match client.id {
        "claude-desktop" => { let dir = claude_desktop_dir()?; (dir.join("claude_desktop_config.json"), dir) }
        "claude-code" => { let home = home()?; (home.join(".claude.json"), home.join(".claude")) }
        "codex" => { let dir = home()?.join(".codex"); (dir.join("config.toml"), dir) }
        "cursor" => { let dir = home()?.join(".cursor"); (dir.join("mcp.json"), dir) }
        "vscode" => { let dir = roaming()?.join("Code").join("User"); (dir.join("mcp.json"), dir) }
        "gemini" => { let dir = home()?.join(".gemini"); (dir.join("settings.json"), dir) }
        _ => return None,
    })
}

fn exe() -> Result<String, String> {
    env::current_exe().map(|path| path.to_string_lossy().to_string()).map_err(|err| format!("Cannot find Game Access's program: {err}"))
}

fn entry(client: &Client, exe: &str) -> Value {
    let mut value = json!({ "command": exe, "args": ["--mcp-stdio"] });
    if client.typed { value["type"] = json!("stdio"); }
    value
}

fn toml_block(exe: &str) -> String {
    // TOML basic strings: a Windows path's backslashes are escaped.
    format!("[mcp_servers.{SERVER_NAME}]\ncommand = \"{}\"\nargs = [\"--mcp-stdio\"]\n", exe.replace('\\', "\\\\").replace('"', "\\\""))
}

/// The lines of `[mcp_servers.game-access]` up to the next table, as a range of the text.
fn toml_range(text: &str) -> Option<(usize, usize)> {
    let header = format!("[mcp_servers.{SERVER_NAME}]");
    let start = text.lines().scan(0usize, |pos, line| { let at = *pos; *pos += line.len() + 1; Some((at, line)) })
        .find(|(_, line)| line.trim() == header).map(|(at, _)| at)?;
    let after = start + header.len();
    let end = text[after..].lines().scan(after, |pos, line| { let at = *pos; *pos += line.len() + 1; Some((at, line)) })
        .skip(1).find(|(_, line)| line.trim_start().starts_with('[')).map(|(at, _)| at).unwrap_or(text.len());
    Some((start, end.min(text.len())))
}

fn read_text(path: &Path) -> Result<String, String> {
    match fs::read_to_string(path) {
        Ok(text) => Ok(text),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(String::new()),
        Err(err) => Err(format!("Cannot read {}: {err}", path.display())),
    }
}

fn write_text(path: &Path, text: &str) -> Result<(), String> {
    if let Some(dir) = path.parent() { fs::create_dir_all(dir).map_err(|err| format!("Cannot create {}: {err}", dir.display()))?; }
    let backup = path.with_extension(format!("{}.bak", path.extension().and_then(|e| e.to_str()).unwrap_or("cfg")));
    if path.is_file() && !backup.exists() { let _ = fs::copy(path, &backup); }
    let temp = path.with_extension("gameaccess.tmp");
    fs::write(&temp, text).map_err(|err| format!("Cannot write {}: {err}", path.display()))?;
    fs::rename(&temp, path).map_err(|err| format!("Cannot write {}: {err}", path.display()))
}

fn read_json(path: &Path) -> Result<Value, String> {
    let text = read_text(path)?;
    // VS Code's files may carry comments: a file that is not plain JSON is left alone rather than rewritten.
    if text.trim().is_empty() { return Ok(json!({})); }
    serde_json::from_str(&text).map_err(|_| format!("{} is not plain JSON (comments?); add Game Access by hand with Copy.", path.display()))
}

fn configured_in(client: &Client, path: &Path) -> bool {
    let Ok(text) = read_text(path) else { return false };
    match client.format {
        Format::CodexToml => toml_range(&text).is_some(),
        Format::Json(key) => serde_json::from_str::<Value>(&text).ok().is_some_and(|value| value.get(key).and_then(|servers| servers.get(SERVER_NAME)).is_some()),
    }
}

fn apply(client: &Client, path: &Path, exe: &str, add: bool) -> Result<(), String> {
    match client.format {
        Format::CodexToml => {
            let mut text = read_text(path)?;
            if let Some((start, end)) = toml_range(&text) { text.replace_range(start..end, ""); }
            if add {
                if !text.is_empty() && !text.ends_with('\n') { text.push('\n'); }
                if !text.is_empty() { text.push('\n'); }
                text.push_str(&toml_block(exe));
            }
            write_text(path, &text)
        }
        Format::Json(key) => {
            let mut value = read_json(path)?;
            if !value.is_object() { return Err(format!("{} is not a JSON object", path.display())); }
            if add {
                let servers = value.as_object_mut().unwrap().entry(key).or_insert_with(|| json!({}));
                if !servers.is_object() { *servers = json!({}); }
                servers[SERVER_NAME] = entry(client, exe);
            } else if let Some(servers) = value.get_mut(key).and_then(Value::as_object_mut) {
                servers.remove(SERVER_NAME);
            }
            write_text(path, &(serde_json::to_string_pretty(&value).map_err(|err| err.to_string())? + "\n"))
        }
    }
}

fn snippet(client: &Client, exe: &str) -> String {
    match client.format {
        Format::CodexToml => toml_block(exe),
        Format::Json(key) => serde_json::to_string_pretty(&json!({ key: { SERVER_NAME: entry(client, exe) } })).unwrap_or_default(),
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpClient {
    id: String,
    name: String,
    /// The client seems to be on this PC (its settings folder exists).
    found: bool,
    configured: bool,
    path: String,
    /// What to paste in its settings by hand.
    snippet: String,
}

fn find(id: &str) -> Result<&'static Client, String> { CLIENTS.iter().find(|client| client.id == id).ok_or_else(|| format!("Unknown AI app: {id}")) }

fn describe(client: &Client, exe: &str) -> Option<McpClient> {
    let (file, dir) = paths(client)?;
    Some(McpClient {
        id: client.id.into(), name: client.name.into(), found: dir.is_dir() || file.is_file(),
        configured: configured_in(client, &file), path: file.to_string_lossy().to_string(), snippet: snippet(client, exe),
    })
}

#[tauri::command]
pub fn mcp_clients() -> Result<Vec<McpClient>, String> {
    let exe = exe()?;
    Ok(CLIENTS.iter().filter_map(|client| describe(client, &exe)).collect())
}

/// Adds Game Access to one AI app's settings (`add`), or takes it out. The app may need a restart to see it.
#[tauri::command]
pub fn mcp_client_setup(id: String, add: bool) -> Result<McpClient, String> {
    let client = find(&id)?;
    let exe = exe()?;
    let (file, _) = paths(client).ok_or("This PC has no settings folder for that app")?;
    apply(client, &file, &exe, add)?;
    describe(client, &exe).ok_or_else(|| "Cannot read the app's settings".into())
}

// ---- The stdio bridge ----

fn rpc_error(id: &Value, message: &str) -> Value { json!({ "jsonrpc": "2.0", "id": id, "error": { "code": -32000, "message": message } }) }

const CLOSED: &str = "Game Access is not open, or its AI control is off. Open Game Access and turn it on in Settings › AI control.";

/// `gameaccess-desktop.exe --mcp-stdio`, started by an AI app: one JSON-RPC message per line on stdin, forwarded to the
/// open app's door with the token; each answer goes back as one line on stdout. While Game Access is closed it still
/// answers `initialize` (so the AI app keeps the server and can say why the tools fail) and says how to open it.
pub fn run_stdio_bridge() {
    let client = reqwest::blocking::Client::builder().timeout(Duration::from_secs(150)).no_proxy().build();
    let stdin = std::io::stdin();
    let mut stdout = std::io::stdout();
    for line in stdin.lock().lines() {
        let Ok(line) = line else { break };
        if line.trim().is_empty() { continue; }
        let Ok(message) = serde_json::from_str::<Value>(&line) else { continue };
        let id = message.get("id").cloned();
        let answer = forward(client.as_ref().ok(), &line).unwrap_or_else(|_| {
            let id = id.clone().unwrap_or(Value::Null);
            if message.get("method").and_then(Value::as_str) == Some("initialize") {
                let mut local = crate::mcp_server::answer_locally(&message).unwrap_or_else(|| rpc_error(&id, CLOSED));
                local["result"]["instructions"] = json!(CLOSED);
                Some(local)
            } else if message.get("id").is_some() {
                Some(rpc_error(&id, CLOSED))
            } else {
                None
            }
        });
        if let Some(answer) = answer {
            if writeln!(stdout, "{answer}").and_then(|_| stdout.flush()).is_err() { break; }
        }
    }
}

/// One message through the door: Ok(None) for a notification (202), Err when the app cannot be reached.
fn forward(client: Option<&reqwest::blocking::Client>, line: &str) -> Result<Option<Value>, String> {
    let client = client.ok_or("no HTTP client")?;
    let access = crate::mcp_server::access_for_bridge()?;
    let response = client.post(&access.0).header("Authorization", format!("Bearer {}", access.1)).header("Content-Type", "application/json")
        .header("Accept", "application/json, text/event-stream").body(line.to_string()).send().map_err(|err| err.to_string())?;
    if response.status().as_u16() == 202 { return Ok(None); }
    if !response.status().is_success() && response.status().as_u16() != 400 { return Err(format!("HTTP {}", response.status())); }
    response.json::<Value>().map(Some).map_err(|err| err.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn json_clients_keep_the_rest_of_their_file_and_can_take_it_out_again() {
        let dir = env::temp_dir().join(format!("ga-mcp-clients-{}", std::process::id()));
        let file = dir.join("mcp.json");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        fs::write(&file, r#"{ "theme": "dark", "mcpServers": { "other": { "command": "x" } } }"#).unwrap();
        let cursor = find("cursor").unwrap();
        apply(cursor, &file, r"C:\Program Files\gameAccess\gameaccess-desktop.exe", true).unwrap();
        let value: Value = serde_json::from_str(&fs::read_to_string(&file).unwrap()).unwrap();
        assert_eq!(value["theme"], "dark");
        assert_eq!(value["mcpServers"]["other"]["command"], "x");
        assert_eq!(value["mcpServers"][SERVER_NAME]["args"][0], "--mcp-stdio");
        assert!(configured_in(cursor, &file));
        assert!(dir.join("mcp.json.bak").is_file());
        apply(cursor, &file, "x", false).unwrap();
        assert!(!configured_in(cursor, &file));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn codex_gets_its_own_table_once_and_loses_only_that_table() {
        let dir = env::temp_dir().join(format!("ga-mcp-codex-{}", std::process::id()));
        let file = dir.join("config.toml");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        fs::write(&file, "model = \"o4\"\n\n[mcp_servers.other]\ncommand = \"x\"\n").unwrap();
        let codex = find("codex").unwrap();
        apply(codex, &file, r"C:\A\b.exe", true).unwrap();
        apply(codex, &file, r"C:\A\b.exe", true).unwrap();
        let text = fs::read_to_string(&file).unwrap();
        assert_eq!(text.matches("[mcp_servers.game-access]").count(), 1);
        assert!(text.contains(r#"command = "C:\\A\\b.exe""#));
        assert!(text.contains("[mcp_servers.other]"));
        apply(codex, &file, "x", false).unwrap();
        let text = fs::read_to_string(&file).unwrap();
        assert!(!text.contains("game-access") && text.contains("[mcp_servers.other]") && text.contains("model = \"o4\""));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_json_file_with_comments_is_not_rewritten() {
        let dir = env::temp_dir().join(format!("ga-mcp-comments-{}", std::process::id()));
        let file = dir.join("mcp.json");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        fs::write(&file, "{ // mine\n \"servers\": {} }").unwrap();
        assert!(apply(find("vscode").unwrap(), &file, "x", true).is_err());
        assert!(fs::read_to_string(&file).unwrap().contains("// mine"));
        let _ = fs::remove_dir_all(&dir);
    }
}
