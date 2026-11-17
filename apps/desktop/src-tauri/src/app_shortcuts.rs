//! Shortcuts to programs that are not library games (Roblox, a drawing program...): only a name and what to open.
//! They are never matched to a Steam AppID nor moved into the games folder; the library manager lists them in their own
//! section, and kid mode can let a child open them (kid_mode.rs).
//!
//! Kept per account in `%LOCALAPPDATA%\gameAccess\shortcuts.json`. A path inside the account's own folders is stored
//! with its variable (`%LOCALAPPDATA%\Roblox\...`): a child's account then finds its own copy of the program.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::process::Command;

#[cfg(windows)]
use std::os::windows::process::CommandExt;
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// The account folders a path is stored relative to, most specific first.
const PORTABLE: [&str; 5] = ["LOCALAPPDATA", "APPDATA", "USERPROFILE", "ProgramFiles(x86)", "ProgramFiles"];

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct AppShortcut {
    /// Seconds since 1970 when it was added; a child sees it as game `-id` (kid_mode.rs).
    pub id: i64,
    pub name: String,
    /// The program (or a link such as `roblox://`) as stored, maybe with `%VARIABLE%`.
    pub target: String,
    pub arguments: Vec<String>,
    /// The program's own folder (what a child's account is allowed to run, and how its processes are recognised).
    pub folder: String,
    /// The file that was picked (a .lnk, .url or .exe).
    pub source: String,
}

fn store_path() -> Option<PathBuf> {
    std::env::var_os("LOCALAPPDATA").map(|base| PathBuf::from(base).join("gameAccess").join("shortcuts.json"))
}

fn read_all() -> Vec<AppShortcut> {
    store_path().and_then(|path| std::fs::read_to_string(path).ok()).and_then(|text| serde_json::from_str(&text).ok()).unwrap_or_default()
}

fn write_all(items: &[AppShortcut]) -> Result<(), String> {
    let path = store_path().ok_or("no_appdata")?;
    if let Some(parent) = path.parent() { std::fs::create_dir_all(parent).map_err(|error| error.to_string())?; }
    std::fs::write(path, serde_json::to_string_pretty(items).map_err(|error| error.to_string())?).map_err(|error| error.to_string())
}

/// `%NAME%` replaced by this account's value.
pub fn expand(value: &str) -> String {
    PORTABLE.iter().fold(value.to_string(), |text, name| {
        let token = format!("%{name}%");
        match std::env::var(name) { Ok(real) if text.contains(&token) => text.replace(&token, &real), _ => text }
    })
}

/// The account's folder at the start of `path` written as its variable.
fn portable_with(path: &str, lookup: impl Fn(&str) -> Option<String>) -> String {
    for name in PORTABLE {
        let Some(base) = lookup(name) else { continue };
        let base = base.trim_end_matches('\\');
        if !base.is_empty() && path.len() > base.len() && path[..base.len()].eq_ignore_ascii_case(base) && path[base.len()..].starts_with('\\') {
            return format!("%{name}%{}", &path[base.len()..]);
        }
    }
    path.to_string()
}

/// The program's own folder: the first folder under one of the account's folders or Program Files
/// (`%LOCALAPPDATA%\Roblox`, whose `Versions\version-…` changes with every update), else the program's folder.
fn program_folder(target: &str) -> String {
    if let Some(rest) = target.strip_prefix('%') {
        if let Some(end) = rest.find('%') {
            let after = &rest[end + 1..];
            let first = after.trim_start_matches('\\').split('\\').next().unwrap_or("");
            // Straight under USERPROFILE (Desktop, Downloads...) is not a program's folder.
            if !first.is_empty() && after.trim_start_matches('\\').contains('\\') && &rest[..end] != "USERPROFILE" {
                return format!("%{}%\\{first}", &rest[..end]);
            }
        }
    }
    Path::new(target).parent().map(|folder| folder.display().to_string()).unwrap_or_default()
}

/// What a .lnk opens (Windows' own shortcut reader, through PowerShell).
fn read_link(path: &Path) -> Result<(String, String), String> {
    let script = format!("$s = (New-Object -ComObject WScript.Shell).CreateShortcut('{}'); $s.TargetPath; $s.Arguments", path.display().to_string().replace('\'', "''"));
    let mut command = Command::new("powershell");
    command.args(["-NoProfile", "-NonInteractive", "-Command", &script]);
    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);
    let output = command.output().map_err(|error| error.to_string())?;
    let text = String::from_utf8_lossy(&output.stdout);
    let mut lines = text.lines();
    let target = lines.next().unwrap_or("").trim().to_string();
    if target.is_empty() { return Err("empty_link".into()); }
    Ok((target, lines.next().unwrap_or("").trim().to_string()))
}

/// The `URL=` line of an internet shortcut (.url).
fn read_url(path: &Path) -> Result<String, String> {
    let text = std::fs::read_to_string(path).map_err(|error| error.to_string())?;
    text.lines().find_map(|line| line.strip_prefix("URL=")).map(|url| url.trim().to_string()).ok_or_else(|| "empty_link".into())
}

fn split_arguments(text: &str) -> Vec<String> {
    let mut items = Vec::new();
    let (mut current, mut quoted) = (String::new(), false);
    for c in text.chars() {
        match c {
            '"' => quoted = !quoted,
            ' ' if !quoted => { if !current.is_empty() { items.push(std::mem::take(&mut current)); } }
            _ => current.push(c),
        }
    }
    if !current.is_empty() { items.push(current); }
    items
}

#[tauri::command]
pub fn shortcuts_list() -> Vec<AppShortcut> { read_all() }

/// Adds the picked file (.exe, .lnk or .url). Returns the new shortcut.
#[tauri::command]
pub fn shortcut_add(path: String) -> Result<AppShortcut, String> {
    let file = PathBuf::from(&path);
    if !file.is_file() { return Err("missing".into()); }
    let extension = file.extension().and_then(|value| value.to_str()).unwrap_or("").to_ascii_lowercase();
    let (target, arguments) = match extension.as_str() {
        "lnk" => { let (target, arguments) = read_link(&file)?; (target, split_arguments(&arguments)) }
        "url" => (read_url(&file)?, Vec::new()),
        "exe" => (path.clone(), Vec::new()),
        _ => return Err("unsupported".into()),
    };
    let link = target.contains("://");
    let target = if link { target } else { portable_with(&target, |name| std::env::var(name).ok()) };
    let mut items = read_all();
    let mut id = chrono::Utc::now().timestamp();
    while items.iter().any(|item| item.id == id) { id += 1; }
    let name = file.file_stem().and_then(|value| value.to_str()).unwrap_or("App").to_string();
    let shortcut = AppShortcut { id, name, folder: if link { String::new() } else { program_folder(&target) }, target, arguments, source: path };
    items.push(shortcut.clone());
    write_all(&items)?;
    Ok(shortcut)
}

#[tauri::command]
pub fn shortcut_remove(id: i64) -> Result<(), String> {
    let mut items = read_all();
    items.retain(|item| item.id != id);
    write_all(&items)
}

/// Opens a program or a link the way Windows would.
pub fn launch(target: &str, arguments: &[String]) -> Result<Option<std::process::Child>, String> {
    let target = expand(target);
    if target.contains("://") || !target.to_ascii_lowercase().ends_with(".exe") {
        let mut command = Command::new("cmd");
        command.args(["/c", "start", "", &target]).args(arguments);
        #[cfg(windows)]
        command.creation_flags(CREATE_NO_WINDOW);
        command.spawn().map_err(|error| error.to_string())?;
        return Ok(None);
    }
    let exe = PathBuf::from(&target);
    let dir = exe.parent().map(Path::to_path_buf).unwrap_or_default();
    Command::new(&exe).args(arguments).current_dir(dir).spawn().map(Some).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn shortcut_open(id: i64) -> Result<(), String> {
    let item = read_all().into_iter().find(|item| item.id == id).ok_or("missing")?;
    launch(&item.target, &item.arguments).map(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_program_in_the_accounts_folders_is_kept_with_its_variable() {
        let lookup = |name: &str| match name { "LOCALAPPDATA" => Some(r"C:\Users\seba\AppData\Local".to_string()), "ProgramFiles" => Some(r"C:\Program Files".to_string()), _ => None };
        let roblox = portable_with(r"C:\Users\Seba\AppData\Local\Roblox\Versions\version-1\RobloxPlayerBeta.exe", lookup);
        assert_eq!(roblox, r"%LOCALAPPDATA%\Roblox\Versions\version-1\RobloxPlayerBeta.exe");
        assert_eq!(program_folder(&roblox), r"%LOCALAPPDATA%\Roblox");
        let krita = portable_with(r"C:\Program Files\Krita (x64)\bin\krita.exe", lookup);
        assert_eq!(program_folder(&krita), r"%ProgramFiles%\Krita (x64)");
        assert_eq!(program_folder(r"D:\Apps\paint.exe"), r"D:\Apps");
        assert_eq!(split_arguments(r#"--app "C:\a b" -x"#), vec!["--app", r"C:\a b", "-x"]);
    }
}
