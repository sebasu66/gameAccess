//! Kid mode's restrictor (vault/Modo niño.md, "Modelo nuevo"; MN.17 and MN.18): a Windows service that, while kid mode
//! is on, lets only the allow list run in the users' sessions and closes everything else at once.
//!
//! The same executable is the service: Windows starts `gameaccess-desktop.exe --restrictor` as SYSTEM (the installer
//! registers it, windows/hooks.nsh), and `--restrictor-console` runs the same loop in the foreground, to try it. It
//! looks at the processes of the users' sessions every 0.7 s; what was already running when kid mode came on is left
//! alone. Allowed: Windows and Microsoft's programs, Game Access, Steam's client (not its games), the library games
//! assigned to the child (and what they open) and the installed programs the parent left ticked. A process outside the
//! list is closed; the block is written down for the parent and Game Access shows the notice, opened in that session
//! when it was not running.
//!
//! The settings live in `%ProgramData%\GameAccess\restriccion\config.json`, written by the parent's Game Access
//! (Users may change that folder: the child uses the same Windows account, so there is nothing to keep apart there; the
//! parent's key in Game Access is the barrier). Windows APIs are called directly, with no extra crate.
//! Not yet: the time limits and hours of the new model (MN.20).

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, SystemTime};

pub const SERVICE_FLAG: &str = "--restrictor";
pub const CONSOLE_FLAG: &str = "--restrictor-console";
pub const SERVICE_NAME: &str = "GameAccessRestrictor";
const TICK: Duration = Duration::from_millis(700);
const BLOCKS_KEPT: usize = 200;

/// An installed program the parent left allowed: everything under its folder runs.
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct AllowedProgram {
    pub name: String,
    pub folder: String,
}

/// A common program known by its executable (Seba, 2026-10-30): `chrome.exe`, and words its properties (product,
/// description, company, original name) must hold: "google chrome". Allowed only when both match, so a game renamed to
/// `chrome.exe` does not pass; closed when either its name or its original name (which renaming does not change) is it.
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct KnownExe {
    pub exe: String,
    pub marks: Vec<String>,
}

/// What the parent set: the child (its games, as in the old family file) and the programs allowed besides them.
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Restriction {
    pub version: u32,
    /// The restrictor closes what is not allowed only while this is on (the big switch in parental control).
    pub enabled: bool,
    pub kid: crate::kid_mode::Kid,
    pub programs: Vec<AllowedProgram>,
    /// The common programs left on (browsers, chat, tools: the wizard's list), wherever they are installed.
    pub allowed_exes: Vec<KnownExe>,
    /// The common programs the parent turned off: closed even when Windows' own (Notepad, Edge, the Store).
    pub blocked_exes: Vec<KnownExe>,
    /// For the parent's screen only: which common programs were turned off (by their name in the list).
    pub blocked_defaults: Vec<String>,
}

/// One process that was closed, for the parent's list and for the notice.
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Block {
    /// Milliseconds since 1970.
    pub at: u64,
    pub name: String,
    pub path: String,
    /// It looks like a game (the notice then says to add it in the library).
    pub game: bool,
    pub count: u32,
}

pub fn dir() -> PathBuf {
    if let Some(dir) = std::env::var_os("GAMEACCESS_RESTRICTION_DIR") { return PathBuf::from(dir); }
    let base = std::env::var_os("ProgramData").map(PathBuf::from).unwrap_or_else(|| PathBuf::from(r"C:\ProgramData"));
    base.join("GameAccess").join("restriccion")
}
fn config_path() -> PathBuf { dir().join("config.json") }
fn blocks_path() -> PathBuf { dir().join("bloqueos.json") }
fn notice_path() -> PathBuf { dir().join("aviso.json") }
fn parent_path() -> PathBuf { dir().join("padre.json") }

/// How long the parent's presence lasts without a new word from Game Access (it says it every 30 s in parent mode).
const PARENT_FRESH_MS: u64 = 60_000;

/// Whether Game Access is in parent mode now (Seba, 2026-10-30): its last word about it is fresh. While it is, kid mode
/// pauses; once Game Access leaves parent mode, closes, or stops saying it, kid mode restricts again within a minute.
fn parent_present() -> bool {
    let at = std::fs::read_to_string(parent_path()).ok().and_then(|text| serde_json::from_str::<serde_json::Value>(&text).ok())
        .and_then(|value| value.get("at").and_then(serde_json::Value::as_u64)).unwrap_or(0);
    let now = now_ms();
    at <= now + 5_000 && now.saturating_sub(at) < PARENT_FRESH_MS
}

pub fn read_config() -> Option<Restriction> {
    let text = std::fs::read_to_string(config_path()).ok()?;
    serde_json::from_str(text.trim_start_matches('\u{feff}')).ok()
}

fn now_ms() -> u64 { SystemTime::now().duration_since(SystemTime::UNIX_EPOCH).map(|time| time.as_millis() as u64).unwrap_or(0) }

fn norm(value: &str) -> String { value.replace('/', "\\").trim_end_matches('\\').to_lowercase() }

/// Whether `path` is `folder` or inside it, ignoring case and slash style.
fn inside(folder: &str, path: &str) -> bool {
    let (folder, path) = (norm(folder), norm(path));
    !folder.is_empty() && path.starts_with(&folder) && (path.len() == folder.len() || path[folder.len()..].starts_with('\\'))
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Verdict {
    Allow,
    /// One of the child's games (its AppID): what it opens is allowed too.
    Game(i64),
    Block { game: bool },
}

/// What always runs wherever it is installed, as parts of a path (lower case): Microsoft's per-user and shared data
/// (OneDrive, Teams, Defender), Game Access itself (its tools and data, and the download plugins) and, by Seba's choice
/// (2026-10-30), programming tools and local servers, so the PC can still be worked on with kid mode on. A child could
/// name a folder like one of these to get past it: accepted for children under 12.
const ALWAYS_PARTS: &[&str] = &[
    r"\appdata\local\microsoft\", r"\programdata\microsoft\", r"\program files\windowsapps\",
    // Game Access: DepotDownloader and the launcher's data, the source plugins, a development build and its tests.
    r"\appdata\local\gameaccess\", r"\appdata\roaming\gameaccess\", r"\src-tauri\target\",
    // Programming tools and local servers.
    r"\program files\nodejs\", r"\program files\git\", r"\program files\github cli\", r"\program files\powershell\",
    r"\program files\docker\", r"\program files\python", r"\appdata\local\programs\python\", r"\.cargo\bin\", r"\.rustup\",
    r"\appdata\roaming\npm\", r"\appdata\local\pnpm\", r"\node_modules\", r"\.venv\", r"\miniconda3\", r"\anaconda3\",
    r"\scoop\", r"\.local\bin\", r"\program files (x86)\windows kits\", r"\appdata\local\tauri\",
    // Claude and Claude Code (the desktop app is in WindowsApps, which always runs).
    r"\appdata\roaming\claude\", r"\appdata\local\packages\claude_", r"\appdata\local\anthropicclaude\", r"\appdata\local\programs\claude",
];

/// The allow list, as folders.

pub struct Rules {
    /// Windows, Microsoft's programs, Game Access and Steam's client.
    always: Vec<String>,
    /// Parts of a path that always run, wherever they are: `ALWAYS_PARTS`.
    always_parts: Vec<String>,
    /// Steam libraries: their games are not part of Steam's client.
    steam_games: Vec<String>,
    games: Vec<(i64, String)>,
    programs: Vec<String>,
    allowed_exes: Vec<KnownExe>,
    blocked_exes: Vec<KnownExe>,
    /// An executable's properties as one lower-case text (`properties`; tests give their own).
    props: fn(&str) -> Properties,
}

impl Default for Rules {
    fn default() -> Self {
        Rules { always: Vec::new(), always_parts: Vec::new(), steam_games: Vec::new(), games: Vec::new(), programs: Vec::new(),
                allowed_exes: Vec::new(), blocked_exes: Vec::new(), props: properties }
    }
}

/// Programming tools and local servers that always run wherever they are installed (Seba, 2026-10-30), checked by
/// their properties like the common programs; besides the folders in `ALWAYS_PARTS` (cargo and rustc have no
/// properties: they pass by their folder).
const ALWAYS_EXES: &[(&str, &[&str])] = &[("node.exe", &["node.js"]), ("git.exe", &["git"]), ("gh.exe", &["github"]), ("python.exe", &["python"]),
    ("pythonw.exe", &["python"]), ("py.exe", &["python"]), ("pwsh.exe", &["powershell"]), ("claude.exe", &["claude", "anthropic"]),
    ("gameaccess-desktop.exe", &["gameaccess"])];

fn exe_name(path: &str) -> String {
    path.replace('/', "\\").rsplit('\\').next().unwrap_or("").to_lowercase()
}

/// What an executable says about itself: its original name (".mui" dropped) and the rest of its properties, lower case.
#[derive(Default, Clone, Debug)]
pub struct Properties { pub original: String, pub text: String }

impl Properties {
    fn holds(&self, marks: &[String]) -> bool { marks.iter().any(|mark| !mark.is_empty() && self.text.contains(&mark.to_lowercase())) }
}

/// Reads an executable's version properties (OriginalFilename, ProductName, FileDescription, CompanyName) from Windows.
#[cfg(windows)]
pub fn properties(path: &str) -> Properties {
    #[link(name = "version", kind = "raw-dylib")]
    extern "system" {
        fn GetFileVersionInfoSizeW(file: *const u16, handle: *mut u32) -> u32;
        fn GetFileVersionInfoW(file: *const u16, handle: u32, size: u32, data: *mut u8) -> i32;
        fn VerQueryValueW(block: *const u8, sub: *const u16, buffer: *mut *mut u8, length: *mut u32) -> i32;
    }
    let wide = |text: &str| -> Vec<u16> { text.encode_utf16().chain(std::iter::once(0)).collect() };
    let file = wide(path);
    unsafe {
        let mut ignored = 0u32;
        let size = GetFileVersionInfoSizeW(file.as_ptr(), &mut ignored);
        if size == 0 { return Properties::default(); }
        let mut data = vec![0u8; size as usize];
        if GetFileVersionInfoW(file.as_ptr(), 0, size, data.as_mut_ptr()) == 0 { return Properties::default(); }
        let mut pointer: *mut u8 = std::ptr::null_mut();
        let mut length = 0u32;
        let mut languages = Vec::new();
        if VerQueryValueW(data.as_ptr(), wide("\\VarFileInfo\\Translation").as_ptr(), &mut pointer, &mut length) != 0 && length >= 4 {
            let pairs = std::slice::from_raw_parts(pointer as *const u16, (length / 2) as usize);
            for pair in pairs.chunks(2) { if pair.len() == 2 { languages.push(format!("{:04x}{:04x}", pair[0], pair[1])); } }
        }
        languages.extend(["040904b0".to_string(), "040904e4".to_string()]);
        let read = |language: &str, name: &str| -> String {
            let mut value: *mut u8 = std::ptr::null_mut();
            let mut chars = 0u32;
            let key = wide(&format!("\\StringFileInfo\\{language}\\{name}"));
            if VerQueryValueW(data.as_ptr(), key.as_ptr(), &mut value, &mut chars) == 0 || chars == 0 { return String::new(); }
            let text = std::slice::from_raw_parts(value as *const u16, chars as usize);
            String::from_utf16_lossy(text).trim_end_matches('\0').to_string()
        };
        for language in &languages {
            let original = read(language, "OriginalFilename");
            let rest = ["ProductName", "FileDescription", "CompanyName", "InternalName"].iter().map(|name| read(language, name)).collect::<Vec<_>>().join(" ");
            if !original.is_empty() || !rest.trim().is_empty() {
                let original = original.to_lowercase();
                return Properties { original: original.trim_end_matches(".mui").to_string(), text: format!("{original} {}", rest.to_lowercase()) };
            }
        }
        Properties::default()
    }
}
#[cfg(not(windows))]
pub fn properties(_path: &str) -> Properties { Properties::default() }

impl Rules {
    pub fn new(config: &Restriction, always: Vec<String>, steam_games: Vec<String>) -> Self {
        Rules {
            always,
            always_parts: ALWAYS_PARTS.iter().map(|part| part.to_string()).collect(),
            steam_games,
            games: config.kid.games.iter().filter(|game| !game.folder.trim().is_empty()).map(|game| (game.app_id, game.folder.clone())).collect(),
            programs: config.programs.iter().map(|program| program.folder.clone()).filter(|folder| !folder.trim().is_empty()).collect(),
            allowed_exes: config.allowed_exes.iter().filter(|known| !known.exe.trim().is_empty()).cloned().collect(),
            blocked_exes: config.blocked_exes.iter().filter(|known| !known.exe.trim().is_empty()).cloned().collect(),
            props: properties,
        }
    }

    /// The folders that always run on this PC: Windows, Microsoft's programs, Game Access and Steam's client.
    pub fn system_folders() -> (Vec<String>, Vec<String>) {
        let env = |name: &str| std::env::var(name).unwrap_or_default();
        let mut always = vec![env("SystemRoot"), env("windir")];
        for root in [env("ProgramFiles"), env("ProgramFiles(x86)"), env("ProgramW6432")].into_iter().filter(|root| !root.is_empty()) {
            for part in ["WindowsApps", "Windows Defender", "Windows Defender Advanced Threat Protection", "Windows Mail", "Windows Media Player",
                         "Windows NT", "Windows Photo Viewer", "Windows Security", "Windows Sidebar", "Windows Portable Devices", "Common Files",
                         "Internet Explorer", "Microsoft", "Microsoft Office", "Microsoft Office 15", "Microsoft OneDrive", "Microsoft Update Health Tools",
                         "Microsoft VS Code", "Microsoft Visual Studio", "Microsoft Edge", "Microsoft\\Edge", "Microsoft\\EdgeUpdate", "Microsoft\\EdgeWebView"] {
                always.push(format!("{root}\\{part}"));
            }
        }
        if let Ok(exe) = std::env::current_exe() { if let Some(folder) = exe.parent() { always.push(folder.display().to_string()); } }
        let steam = steam_root();
        let mut steam_games = Vec::new();
        if let Some(root) = steam {
            steam_games = steam_libraries(&root).into_iter().map(|library| format!("{library}\\steamapps")).collect();
            always.push(root);
        }
        always.retain(|folder| !folder.trim().is_empty());
        (always, steam_games)
    }

    pub fn classify(&self, path: &str, parent_game: Option<i64>) -> Verdict {
        if let Some((app_id, _)) = self.games.iter().find(|(_, folder)| inside(folder, path)) { return Verdict::Game(*app_id); }
        if let Some(app_id) = parent_game { return Verdict::Game(app_id); }
        // The common programs: the parent's "No" closes one by its name or its original name, even inside Windows; "Yes"
        // lets it run anywhere when its name and its properties both say it is that program.
        let exe = exe_name(path);
        let named = |known: &str| known.trim().eq_ignore_ascii_case(&exe);
        let wanted = self.blocked_exes.iter().chain(self.allowed_exes.iter()).any(|known| named(&known.exe)) || ALWAYS_EXES.iter().any(|(known, _)| named(known));
        let props = if wanted || !self.blocked_exes.is_empty() { (self.props)(path) } else { Properties::default() };
        if self.blocked_exes.iter().any(|known| named(&known.exe) || (!props.original.is_empty() && known.exe.eq_ignore_ascii_case(&props.original))) {
            return Verdict::Block { game: false };
        }
        if self.allowed_exes.iter().any(|known| named(&known.exe) && props.holds(&known.marks))
            || ALWAYS_EXES.iter().any(|(known, marks)| named(known) && props.holds(&marks.iter().map(|mark| mark.to_string()).collect::<Vec<_>>())) {
            return Verdict::Allow;
        }
        let lower = norm(path);
        // What the parent ticked, even inside a Steam library (Blender through Steam).
        if self.programs.iter().any(|folder| inside(folder, path)) { return Verdict::Allow; }
        // A Steam game is in its library under Steam's own folder, which otherwise runs: the game is not Steam.
        if self.steam_games.iter().any(|folder| inside(folder, path)) { return Verdict::Block { game: true }; }
        if self.always.iter().any(|folder| inside(folder, path)) || self.always_parts.iter().any(|part| lower.contains(part.as_str())) {
            return Verdict::Allow;
        }
        Verdict::Block { game: looks_like_game(path) }
    }
}

/// Only to choose the notice's words: a Steam library, a Game Access game folder ("<appid>-<name>-ready"), a
/// `steam_appid.txt` beside it, or a game engine's runtime.
fn looks_like_game(path: &str) -> bool {
    let lower = norm(path);
    if lower.contains(r"\steamapps\") || lower.ends_with("-shipping.exe") { return true; }
    let file = Path::new(path);
    if file.ancestors().skip(1).take(4).any(|folder| folder.file_name().and_then(|name| name.to_str())
        .is_some_and(|name| name.split('-').next().is_some_and(|id| !id.is_empty() && id.chars().all(|c| c.is_ascii_digit())) && name.contains('-'))) {
        return true;
    }
    let near = |name: &str| file.parent().is_some_and(|folder| folder.join(name).is_file() || folder.parent().is_some_and(|up| up.join(name).is_file()));
    near("steam_appid.txt") || near("UnityPlayer.dll")
}

fn steam_root() -> Option<String> {
    let output = hidden_command("reg").args(["query", r"HKLM\SOFTWARE\WOW6432Node\Valve\Steam", "/v", "InstallPath"]).output().ok()?;
    let text = String::from_utf8_lossy(&output.stdout);
    text.lines().find(|line| line.contains("InstallPath")).and_then(|line| line.split("REG_SZ").nth(1)).map(|value| value.trim().to_string()).filter(|value| !value.is_empty())
}

/// Steam's libraries (`steamapps\libraryfolders.vdf`): each one holds games, never Steam's client.
fn steam_libraries(root: &str) -> Vec<String> {
    let mut libraries = vec![root.to_string()];
    if let Ok(text) = std::fs::read_to_string(Path::new(root).join("steamapps").join("libraryfolders.vdf")) {
        for line in text.lines() {
            let parts: Vec<&str> = line.split('"').collect();
            if parts.len() >= 4 && parts[1] == "path" { libraries.push(parts[3].replace("\\\\", "\\")); }
        }
    }
    libraries.sort(); libraries.dedup();
    libraries
}

fn hidden_command(program: &str) -> std::process::Command {
    let mut command = std::process::Command::new(program);
    #[cfg(windows)]
    { use std::os::windows::process::CommandExt; command.creation_flags(0x0800_0000); }
    command
}

// -- processes ---------------------------------------------------------------------------------------------------

#[derive(Clone, Debug)]
pub struct Proc { pub pid: u32, pub parent: u32, pub session: u32, pub path: Option<String> }

#[cfg(windows)]
#[allow(non_snake_case, clippy::upper_case_acronyms)]
mod win {
    use std::ffi::c_void;
    pub type HANDLE = *mut c_void;
    #[repr(C)]
    pub struct PROCESSENTRY32W {
        pub dwSize: u32, pub cntUsage: u32, pub th32ProcessID: u32, pub th32DefaultHeapID: usize, pub th32ModuleID: u32,
        pub cntThreads: u32, pub th32ParentProcessID: u32, pub pcPriClassBase: i32, pub dwFlags: u32, pub szExeFile: [u16; 260],
    }
    #[repr(C)]
    pub struct STARTUPINFOW {
        pub cb: u32, pub lpReserved: *mut u16, pub lpDesktop: *mut u16, pub lpTitle: *mut u16, pub dwX: u32, pub dwY: u32,
        pub dwXSize: u32, pub dwYSize: u32, pub dwXCountChars: u32, pub dwYCountChars: u32, pub dwFillAttribute: u32,
        pub dwFlags: u32, pub wShowWindow: u16, pub cbReserved2: u16, pub lpReserved2: *mut u8, pub hStdInput: HANDLE,
        pub hStdOutput: HANDLE, pub hStdError: HANDLE,
    }
    #[repr(C)]
    pub struct PROCESS_INFORMATION { pub hProcess: HANDLE, pub hThread: HANDLE, pub dwProcessId: u32, pub dwThreadId: u32 }
    #[repr(C)]
    pub struct SERVICE_STATUS {
        pub dwServiceType: u32, pub dwCurrentState: u32, pub dwControlsAccepted: u32, pub dwWin32ExitCode: u32,
        pub dwServiceSpecificExitCode: u32, pub dwCheckPoint: u32, pub dwWaitHint: u32,
    }
    #[repr(C)]
    pub struct SERVICE_TABLE_ENTRYW { pub lpServiceName: *const u16, pub lpServiceProc: Option<unsafe extern "system" fn(u32, *mut *mut u16)> }

    #[link(name = "kernel32", kind = "raw-dylib")]
    extern "system" {
        pub fn CreateToolhelp32Snapshot(flags: u32, pid: u32) -> HANDLE;
        pub fn Process32FirstW(snapshot: HANDLE, entry: *mut PROCESSENTRY32W) -> i32;
        pub fn Process32NextW(snapshot: HANDLE, entry: *mut PROCESSENTRY32W) -> i32;
        pub fn OpenProcess(access: u32, inherit: i32, pid: u32) -> HANDLE;
        pub fn QueryFullProcessImageNameW(process: HANDLE, flags: u32, name: *mut u16, size: *mut u32) -> i32;
        pub fn ProcessIdToSessionId(pid: u32, session: *mut u32) -> i32;
        pub fn TerminateProcess(process: HANDLE, code: u32) -> i32;
        pub fn CloseHandle(handle: HANDLE) -> i32;
    }
    #[link(name = "wtsapi32", kind = "raw-dylib")]
    extern "system" { pub fn WTSQueryUserToken(session: u32, token: *mut HANDLE) -> i32; }
    #[link(name = "userenv", kind = "raw-dylib")]
    extern "system" {
        pub fn CreateEnvironmentBlock(env: *mut *mut c_void, token: HANDLE, inherit: i32) -> i32;
        pub fn DestroyEnvironmentBlock(env: *mut c_void) -> i32;
    }
    #[link(name = "advapi32", kind = "raw-dylib")]
    extern "system" {
        pub fn CreateProcessAsUserW(token: HANDLE, app: *const u16, command: *mut u16, pa: *mut c_void, ta: *mut c_void, inherit: i32,
                                    flags: u32, env: *mut c_void, dir: *const u16, si: *mut STARTUPINFOW, pi: *mut PROCESS_INFORMATION) -> i32;
        pub fn StartServiceCtrlDispatcherW(table: *const SERVICE_TABLE_ENTRYW) -> i32;
        pub fn RegisterServiceCtrlHandlerExW(name: *const u16, handler: unsafe extern "system" fn(u32, u32, *mut c_void, *mut c_void) -> u32,
                                             context: *mut c_void) -> HANDLE;
        pub fn SetServiceStatus(handle: HANDLE, status: *mut SERVICE_STATUS) -> i32;
    }
    pub const TH32CS_SNAPPROCESS: u32 = 0x2;
    pub const PROCESS_QUERY_LIMITED_INFORMATION: u32 = 0x1000;
    pub const PROCESS_TERMINATE: u32 = 0x1;
    pub const INVALID_HANDLE_VALUE: HANDLE = -1isize as HANDLE;
    pub const CREATE_UNICODE_ENVIRONMENT: u32 = 0x400;
    pub const SERVICE_WIN32_OWN_PROCESS: u32 = 0x10;
    pub const SERVICE_RUNNING: u32 = 4;
    pub const SERVICE_STOP_PENDING: u32 = 3;
    pub const SERVICE_STOPPED: u32 = 1;
    pub const SERVICE_ACCEPT_STOP: u32 = 1;
    pub const SERVICE_ACCEPT_SHUTDOWN: u32 = 4;
    pub const SERVICE_CONTROL_STOP: u32 = 1;
    pub const SERVICE_CONTROL_SHUTDOWN: u32 = 5;
    pub const SERVICE_CONTROL_INTERROGATE: u32 = 4;
    pub fn wide(text: &str) -> Vec<u16> { text.encode_utf16().chain(std::iter::once(0)).collect() }
}

/// Every process, with its parent, session and executable (none for the protected ones).
#[cfg(windows)]
pub fn processes() -> Vec<Proc> {
    use win::*;
    let mut found = Vec::new();
    unsafe {
        let snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
        if snapshot.is_null() || snapshot == INVALID_HANDLE_VALUE { return found; }
        let mut entry: PROCESSENTRY32W = std::mem::zeroed();
        entry.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
        let mut more = Process32FirstW(snapshot, &mut entry) != 0;
        while more {
            let pid = entry.th32ProcessID;
            let mut session = 0u32;
            ProcessIdToSessionId(pid, &mut session);
            let mut path = None;
            let process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
            if !process.is_null() {
                let mut buffer = [0u16; 1024];
                let mut size = buffer.len() as u32;
                if QueryFullProcessImageNameW(process, 0, buffer.as_mut_ptr(), &mut size) != 0 { path = Some(String::from_utf16_lossy(&buffer[..size as usize])); }
                CloseHandle(process);
            }
            found.push(Proc { pid, parent: entry.th32ParentProcessID, session, path });
            more = Process32NextW(snapshot, &mut entry) != 0;
        }
        CloseHandle(snapshot);
    }
    found
}
#[cfg(not(windows))]
pub fn processes() -> Vec<Proc> { Vec::new() }

#[cfg(windows)]
fn terminate(pid: u32) -> bool {
    use win::*;
    unsafe {
        let process = OpenProcess(PROCESS_TERMINATE, 0, pid);
        if process.is_null() { return false; }
        let done = TerminateProcess(process, 1) != 0;
        CloseHandle(process);
        done
    }
}
#[cfg(not(windows))]
fn terminate(_pid: u32) -> bool { false }

/// Opens Game Access in a user's session, as that user (the service runs as SYSTEM, in no session of its own). A
/// restrictor run by hand (console) simply starts it.
#[cfg(windows)]
fn open_game_access(session: u32, as_service: bool) {
    let Ok(exe) = std::env::current_exe() else { return };
    if !as_service { let _ = std::process::Command::new(&exe).spawn(); return; }
    use win::*;
    unsafe {
        let mut token: HANDLE = std::ptr::null_mut();
        if WTSQueryUserToken(session, &mut token) == 0 { return; }
        let mut env: *mut std::ffi::c_void = std::ptr::null_mut();
        let has_env = CreateEnvironmentBlock(&mut env, token, 0) != 0;
        let app = wide(&exe.display().to_string());
        let mut command = wide(&format!("\"{}\"", exe.display()));
        let mut desktop = wide("winsta0\\default");
        let mut startup: STARTUPINFOW = std::mem::zeroed();
        startup.cb = std::mem::size_of::<STARTUPINFOW>() as u32;
        startup.lpDesktop = desktop.as_mut_ptr();
        let mut info: PROCESS_INFORMATION = std::mem::zeroed();
        let dir = exe.parent().map(|folder| wide(&folder.display().to_string()));
        if CreateProcessAsUserW(token, app.as_ptr(), command.as_mut_ptr(), std::ptr::null_mut(), std::ptr::null_mut(), 0,
                                CREATE_UNICODE_ENVIRONMENT, if has_env { env } else { std::ptr::null_mut() },
                                dir.as_ref().map_or(std::ptr::null(), |dir| dir.as_ptr()), &mut startup, &mut info) != 0 {
            CloseHandle(info.hProcess); CloseHandle(info.hThread);
        }
        if has_env { DestroyEnvironmentBlock(env); }
        CloseHandle(token);
    }
}
#[cfg(not(windows))]
fn open_game_access(_session: u32, _as_service: bool) {}

// -- the loop ------------------------------------------------------------------------------------------------------

fn log(message: &str) {
    let line = format!("{} {message}\n", chrono::Local::now().format("%Y-%m-%d %H:%M:%S"));
    let path = dir().join("restrictor.log");
    if std::fs::metadata(&path).map(|meta| meta.len() > 2_000_000).unwrap_or(false) { let _ = std::fs::rename(&path, dir().join("restrictor.old.log")); }
    if let Ok(mut file) = std::fs::OpenOptions::new().create(true).append(true).open(path) { let _ = std::io::Write::write_all(&mut file, line.as_bytes()); }
}

/// Adds a closed process to the parent's list (one row per executable, the latest first) and to the notice.
fn record(block: &Block) {
    let mut list: Vec<Block> = std::fs::read_to_string(blocks_path()).ok().and_then(|text| serde_json::from_str(&text).ok()).unwrap_or_default();
    let count = list.iter().find(|item| norm(&item.path) == norm(&block.path)).map_or(0, |item| item.count);
    list.retain(|item| norm(&item.path) != norm(&block.path));
    list.insert(0, Block { count: count + 1, ..block.clone() });
    list.truncate(BLOCKS_KEPT);
    let _ = std::fs::write(blocks_path(), serde_json::to_string(&list).unwrap_or_default());
    let _ = std::fs::write(notice_path(), serde_json::to_string(block).unwrap_or_default());
}

pub struct Watcher {
    as_service: bool,
    config: Option<Restriction>,
    config_stamp: Option<SystemTime>,
    rules: Rules,
    /// What was decided for each process seen since kid mode came on (by pid; gone ones are forgotten).
    seen: HashMap<u32, Verdict>,
    baseline: bool,
    /// When Game Access was last opened for a notice in each session (not again for every closed helper).
    opened: HashMap<u32, u64>,
    /// Tests only: look at the children of this process and nothing else on the PC.
    only_children_of: Option<u32>,
    /// The parent is in parent mode in Game Access: nothing is closed meanwhile.
    paused: bool,
}

impl Watcher {
    pub fn new(as_service: bool) -> Self {
        Watcher { as_service, config: None, config_stamp: None, rules: Rules::default(), seen: HashMap::new(), baseline: true, opened: HashMap::new(), only_children_of: None, paused: false }
    }

    fn reload(&mut self) {
        let stamp = std::fs::metadata(config_path()).and_then(|meta| meta.modified()).ok();
        if stamp == self.config_stamp && self.config.is_some() { return; }
        self.config_stamp = stamp;
        self.config = read_config();
        let (always, steam_games) = Rules::system_folders();
        self.rules = self.config.as_ref().map(|config| Rules::new(config, always, steam_games)).unwrap_or_default();
        log(&format!("Settings read: kid mode {}, {} game(s), {} program(s).", if self.on() { "on" } else { "off" },
            self.config.as_ref().map_or(0, |config| config.kid.games.len()), self.config.as_ref().map_or(0, |config| config.programs.len())));
    }

    fn on(&self) -> bool { self.config.as_ref().is_some_and(|config| config.enabled) }

    pub fn tick(&mut self) {
        self.reload();
        if !self.on() { self.seen.clear(); self.baseline = true; return; }
        // The parent in parent mode: kid mode pauses. Back to restricting, what the parent left running stays (baseline).
        let parent = parent_present();
        if parent != self.paused {
            self.paused = parent;
            log(if parent { "The parent is in parent mode: kid mode paused." } else { "The parent left parent mode: kid mode restricts again." });
        }
        if parent { self.seen.clear(); self.baseline = true; return; }
        let all = processes();
        let alive: std::collections::HashSet<u32> = all.iter().map(|proc| proc.pid).collect();
        self.seen.retain(|pid, _| alive.contains(pid));
        // Kid mode just came on: what is running now stays (Windows, the parent's open programs).
        if self.baseline {
            for proc in &all { self.seen.insert(proc.pid, Verdict::Allow); }
            self.baseline = false;
            log("Kid mode on: watching new programs.");
            return;
        }
        for proc in &all {
            if self.seen.contains_key(&proc.pid) || self.only_children_of.is_some_and(|parent| proc.parent != parent) { continue; }
            // Session 0 is Windows' services, and a process whose file cannot be read is a protected one of Windows.
            let verdict = match (&proc.path, proc.session) {
                (_, 0) | (None, _) => Verdict::Allow,
                (Some(path), _) => {
                    let parent = match self.seen.get(&proc.parent) { Some(Verdict::Game(app_id)) => Some(*app_id), _ => None };
                    self.rules.classify(path, parent)
                }
            };
            self.seen.insert(proc.pid, verdict);
            if let (Verdict::Block { game }, Some(path)) = (verdict, &proc.path) {
                let closed = terminate(proc.pid);
                let name = Path::new(path).file_stem().map(|name| name.to_string_lossy().into_owned()).unwrap_or_default();
                log(&format!("Closed {path} (pid {}, session {}, game: {game}, closed: {closed}).", proc.pid, proc.session));
                record(&Block { at: now_ms(), name, path: path.clone(), game, count: 1 });
                self.notify(proc.session, &all);
            }
        }
    }

    /// Game Access shows the notice (it reads `aviso.json`); when it is not open in that session, it is opened.
    fn notify(&mut self, session: u32, all: &[Proc]) {
        let open = all.iter().any(|proc| proc.session == session && proc.path.as_deref().is_some_and(|path| norm(path).ends_with(r"\gameaccess-desktop.exe")));
        let recent = self.opened.get(&session).is_some_and(|at| now_ms().saturating_sub(*at) < 15_000);
        if open || recent { return; }
        self.opened.insert(session, now_ms());
        open_game_access(session, self.as_service);
    }
}

pub static STOP: AtomicBool = AtomicBool::new(false);

fn run_loop(as_service: bool) {
    let _ = std::fs::create_dir_all(dir());
    log(&format!("Restrictor started ({}).", if as_service { "service" } else { "console" }));
    let mut watcher = Watcher::new(as_service);
    while !STOP.load(Ordering::SeqCst) {
        watcher.tick();
        std::thread::sleep(TICK);
    }
    log("Restrictor stopped.");
}

/// `--restrictor` (the service) or `--restrictor-console`: runs the restrictor and returns true (the app must not
/// go on); otherwise false.
pub fn run_if_requested() -> bool {
    let args: Vec<String> = std::env::args().collect();
    if args.iter().any(|arg| arg == CONSOLE_FLAG) { run_loop(false); return true; }
    if args.iter().any(|arg| arg == SERVICE_FLAG) { run_service(); return true; }
    false
}

#[cfg(windows)]
mod service {
    use super::win::*;
    use std::ffi::c_void;
    use std::sync::atomic::{AtomicIsize, Ordering};
    static HANDLE_VALUE: AtomicIsize = AtomicIsize::new(0);

    pub fn set_state(state: u32) {
        let handle = HANDLE_VALUE.load(Ordering::SeqCst) as HANDLE;
        if handle.is_null() { return; }
        let mut status = SERVICE_STATUS { dwServiceType: SERVICE_WIN32_OWN_PROCESS, dwCurrentState: state,
            dwControlsAccepted: if state == SERVICE_RUNNING { SERVICE_ACCEPT_STOP | SERVICE_ACCEPT_SHUTDOWN } else { 0 },
            dwWin32ExitCode: 0, dwServiceSpecificExitCode: 0, dwCheckPoint: 0, dwWaitHint: if state == SERVICE_STOP_PENDING { 5000 } else { 0 } };
        unsafe { SetServiceStatus(handle, &mut status); }
    }

    unsafe extern "system" fn handler(control: u32, _kind: u32, _data: *mut c_void, _context: *mut c_void) -> u32 {
        match control {
            SERVICE_CONTROL_STOP | SERVICE_CONTROL_SHUTDOWN => { set_state(SERVICE_STOP_PENDING); super::STOP.store(true, Ordering::SeqCst); }
            SERVICE_CONTROL_INTERROGATE => {}
            _ => {}
        }
        0
    }

    pub unsafe extern "system" fn main(_argc: u32, _argv: *mut *mut u16) {
        let name = wide(super::SERVICE_NAME);
        let handle = RegisterServiceCtrlHandlerExW(name.as_ptr(), handler, std::ptr::null_mut());
        HANDLE_VALUE.store(handle as isize, Ordering::SeqCst);
        set_state(SERVICE_RUNNING);
        super::run_loop(true);
        set_state(SERVICE_STOPPED);
    }
}

#[cfg(windows)]
fn run_service() {
    let name = win::wide(SERVICE_NAME);
    let table = [win::SERVICE_TABLE_ENTRYW { lpServiceName: name.as_ptr(), lpServiceProc: Some(service::main) },
                 win::SERVICE_TABLE_ENTRYW { lpServiceName: std::ptr::null(), lpServiceProc: None }];
    // Started by hand rather than by Windows: there is no dispatcher to talk to.
    if unsafe { win::StartServiceCtrlDispatcherW(table.as_ptr()) } == 0 { log("--restrictor was not started by Windows' service manager."); }
}
#[cfg(not(windows))]
fn run_service() {}

// -- the parent's Game Access ---------------------------------------------------------------------------------------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RestrictionState {
    pub config: Option<Restriction>,
    /// "running", "stopped" or "missing" (not installed: an older installer, or a development build).
    pub service: String,
    /// Whether this account may write the settings (the installer opens the folder to Users).
    pub writable: bool,
}

fn service_state() -> String {
    let Ok(output) = hidden_command("sc").args(["query", SERVICE_NAME]).output() else { return "missing".into() };
    if !output.status.success() { return "missing".into(); }
    // "STATE : 4  RUNNING" ("ESTADO" in Spanish): the number is what counts in any language.
    let text = String::from_utf8_lossy(&output.stdout);
    let running = text.lines().any(|line| line.split_once(':').is_some_and(|(_, value)| value.trim_start().starts_with("4 ")));
    if running { "running".into() } else { "stopped".into() }
}

fn writable() -> bool {
    let probe = dir().join(format!(".probe-{}", std::process::id()));
    let ok = std::fs::create_dir_all(dir()).is_ok() && std::fs::write(&probe, b"").is_ok();
    let _ = std::fs::remove_file(probe);
    ok
}

#[tauri::command]
pub async fn restriction_state() -> RestrictionState {
    tauri::async_runtime::spawn_blocking(|| RestrictionState { config: read_config(), service: service_state(), writable: writable() }).await
        .unwrap_or(RestrictionState { config: None, service: "missing".into(), writable: false })
}

/// Saves the parent's settings (the restrictor reads them at its next look).
#[tauri::command]
pub fn restriction_save(config: Restriction) -> Result<RestrictionState, String> {
    if crate::kid_mode::kid_account().is_some() { return Err("not_allowed".into()); }
    std::fs::create_dir_all(dir()).map_err(|_| "not_writable".to_string())?;
    let text = serde_json::to_string_pretty(&Restriction { version: 1, ..config }).map_err(|error| error.to_string())?;
    let temp = config_path().with_extension("tmp");
    std::fs::write(&temp, text).and_then(|_| std::fs::rename(&temp, config_path())).map_err(|_| "not_writable".to_string())?;
    Ok(RestrictionState { config: read_config(), service: service_state(), writable: true })
}

/// Undoes the setup: kid mode is off and starts again from the wizard. The list of what was closed goes too.
#[tauri::command]
pub fn restriction_clear() -> Result<(), String> {
    if crate::kid_mode::kid_account().is_some() { return Err("not_allowed".into()); }
    for path in [config_path(), blocks_path(), notice_path()] {
        if let Err(error) = std::fs::remove_file(&path) { if error.kind() != std::io::ErrorKind::NotFound { return Err(error.to_string()); } }
    }
    Ok(())
}

/// Game Access in parent mode says so every 30 s (`present`), and that it left (`false`): kid mode pauses meanwhile.
#[tauri::command]
pub fn restriction_parent(present: bool) -> Result<(), String> {
    if crate::kid_mode::kid_account().is_some() { return Err("not_allowed".into()); }
    if !present {
        return match std::fs::remove_file(parent_path()) { Err(error) if error.kind() != std::io::ErrorKind::NotFound => Err(error.to_string()), _ => Ok(()) };
    }
    std::fs::write(parent_path(), serde_json::json!({ "at": now_ms() }).to_string()).map_err(|_| "not_writable".to_string())
}

/// What the restrictor closed, the latest first (the parent may allow it from there).
#[tauri::command]
pub fn restriction_blocks() -> Vec<Block> {
    std::fs::read_to_string(blocks_path()).ok().and_then(|text| serde_json::from_str(&text).ok()).unwrap_or_default()
}

/// The last block, for the notice: Game Access asks every couple of seconds and shows a newer one.
#[tauri::command]
pub fn restriction_notice() -> Option<Block> {
    std::fs::read_to_string(notice_path()).ok().and_then(|text| serde_json::from_str(&text).ok())
}

/// One program from Windows' list of installed programs, as the wizard shows it.
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct DetectedProgram {
    pub name: String,
    pub publisher: String,
    pub folder: String,
    /// "program" (starts allowed), "game" or "launcher" (a game store: Battle.net, Epic...), which start not allowed
    /// (games come from the library), or "windows" (Windows and Microsoft's: always allowed, nothing to choose).
    pub kind: String,
}

/// An entry as Windows keeps it (`...\CurrentVersion\Uninstall\<key>`).
#[derive(Deserialize, Default, Debug)]
#[serde(default)]
struct UninstallEntry {
    #[serde(rename = "Key")] key: String,
    #[serde(rename = "DisplayName")] name: Option<String>,
    #[serde(rename = "Publisher")] publisher: Option<String>,
    #[serde(rename = "InstallLocation")] location: Option<String>,
    #[serde(rename = "DisplayIcon")] icon: Option<String>,
    #[serde(rename = "UninstallString")] uninstall: Option<String>,
    #[serde(rename = "SystemComponent")] system: Option<serde_json::Value>,
    #[serde(rename = "ParentKeyName")] parent: Option<String>,
}

/// The folder of an executable named in a registry value: `"C:\x\app.exe",0` or `C:\x\app.exe /uninstall`.
fn folder_of_command(value: &str) -> Option<String> {
    let value = value.trim();
    let path = if let Some(rest) = value.strip_prefix('"') { rest.split('"').next()? } else {
        let lower = value.to_lowercase();
        let end = lower.find(".exe").map(|index| index + 4)?;
        &value[..end]
    };
    let path = path.split(',').next()?.trim();
    let lower = path.to_lowercase();
    // Windows' own uninstallers say nothing about where the program is.
    if lower.ends_with("msiexec.exe") || lower.ends_with("rundll32.exe") || !lower.ends_with(".exe") { return None; }
    Path::new(path).parent().map(|folder| folder.display().to_string()).filter(|folder| folder.len() > 3)
}

/// A name as compared with the catalog's: lower case, Roman numbers as digits, letters and digits only.
fn name_key(name: &str) -> String {
    let words: Vec<String> = name.to_lowercase().replace(['™', '®', '©'], " ").split(|c: char| !c.is_alphanumeric()).filter(|word| !word.is_empty())
        .map(|word| match word { "ii" => "2", "iii" => "3", "iv" => "4", "v" if false => "5", "vi" => "6", "vii" => "7", "viii" => "8", other => other }.to_string()).collect();
    words.concat()
}

/// The ways an installed program may name a catalog game: as it is, and without what installers add after the title
/// (" - ElAmigos", " MULTi10", "(x64)", a version number).
fn name_keys(name: &str) -> Vec<String> {
    let lower = name.to_lowercase();
    let mut cut = name.len();
    for mark in [" - ", " multi", "(", " v1", " v2", " version", " versión", ":"] { if let Some(index) = lower.find(mark) { cut = cut.min(index); } }
    let short = &name[..cut];
    let trimmed: Vec<&str> = short.split_whitespace().collect();
    let without_version = trimmed.iter().rev().skip_while(|word| word.chars().any(|c| c.is_ascii_digit()) && word.contains('.')).collect::<Vec<_>>()
        .into_iter().rev().copied().collect::<Vec<_>>().join(" ");
    let mut keys = vec![name_key(name), name_key(short), name_key(&without_version)];
    keys.retain(|key| key.len() >= 3);
    keys.dedup();
    keys
}

/// Game stores and launchers: they open games of their own, so they start not allowed.
fn is_launcher(name: &str) -> bool {
    let lower = name.to_lowercase();
    ["launcher", "battle.net", "ea app", "epic games", "ubisoft connect", "gog galaxy", "curseforge", "fivem", "google play games", "hydra",
     "rockstar games", "itch", "amazon games", "playnite", "xbox", "riot client", "origin", "roblox", "minecraft"].iter().any(|mark| lower.contains(mark))
}

/// Genres of software on Steam (Blender, Wallpaper Engine): a catalog entry with only these is not a game.
const SOFTWARE_GENRES: &[&str] = &["Animation & Modeling", "Design & Illustration", "Video Production", "Audio Production", "Photo Editing",
    "Utilities", "Software Training", "Web Publishing", "Education", "Game Development", "Accounting"];

/// The catalog's games, by `name_key` (software left out).
fn catalog_game_keys() -> std::collections::HashSet<String> {
    crate::catalog_cache::with_catalog_conn(|conn| {
        let mut statement = conn.prepare("SELECT json_extract(payload,'$.name'), json_extract(payload,'$.genres') FROM catalog_game").map_err(|error| error.to_string())?;
        let rows = statement.query_map([], |row| Ok((row.get::<_, Option<String>>(0)?, row.get::<_, Option<String>>(1)?))).map_err(|error| error.to_string())?;
        let mut keys = std::collections::HashSet::new();
        for (name, genres) in rows.flatten() {
            let genres: Vec<String> = genres.and_then(|text| serde_json::from_str(&text).ok()).unwrap_or_default();
            if !genres.is_empty() && genres.iter().all(|genre| SOFTWARE_GENRES.contains(&genre.as_str())) { continue; }
            if let Some(name) = name { let key = name_key(&name); if key.len() >= 3 { keys.insert(key); } }
        }
        Ok(keys)
    }).unwrap_or_default()
}

fn detected(entry: UninstallEntry, games_roots: &[String], steam_games: &[String], windows: &[String], catalog: &std::collections::HashSet<String>) -> Option<DetectedProgram> {
    let name = entry.name.as_deref().map(str::trim).filter(|name| !name.is_empty())?.to_string();
    // Parts and updates of another entry, and components Windows itself hides from its list.
    if entry.parent.is_some() || entry.system.as_ref().is_some_and(|value| value.as_i64() == Some(1) || value.as_str() == Some("1")) { return None; }
    let folder = entry.location.as_deref().map(|folder| folder.trim().trim_matches('"').trim_end_matches('\\').to_string()).filter(|folder| folder.len() > 3)
        .or_else(|| entry.icon.as_deref().and_then(folder_of_command))
        .or_else(|| entry.uninstall.as_deref().and_then(folder_of_command))?;
    let publisher = entry.publisher.unwrap_or_default().trim().to_string();
    let lower_publisher = publisher.to_lowercase();
    let uninstall = entry.uninstall.unwrap_or_default().to_lowercase();
    let lower_folder = folder.to_lowercase();
    let lower_name = name.to_lowercase();
    let windows_part = windows.iter().any(|root| inside(root, &folder)) || lower_publisher.starts_with("microsoft");
    let launcher = !windows_part && is_launcher(&name);
    let game = !launcher && (entry.key.to_lowercase().starts_with("steam app ") || uninstall.contains("steam://")
        || steam_games.iter().any(|library| inside(library, &folder)) || games_roots.iter().any(|root| inside(root, &folder))
        || lower_publisher.starts_with("gog") || lower_folder.contains(r"\gog games\") || lower_folder.contains(r"\epic games\")
        // Repacks, and the usual folders for games installed by hand.
        || ["elamigos", "fitgirl", "dodi", "repack"].iter().any(|mark| lower_name.contains(mark) || lower_publisher.contains(mark))
        || lower_folder.split('\\').any(|part| part == "games" || part == "juegos")
        || name_keys(&name).iter().any(|key| catalog.contains(key)));
    let kind = if game { "game" } else if launcher { "launcher" } else if windows_part { "windows" } else { "program" };
    Some(DetectedProgram { name, publisher, folder, kind: kind.into() })
}

/// Windows' list of installed programs (for the machine, 64 and 32 bits, and for this user), one per folder.
#[tauri::command]
pub async fn restriction_programs() -> Vec<DetectedProgram> {
    tauri::async_runtime::spawn_blocking(|| {
        const SCRIPT: &str = r#"$ErrorActionPreference='SilentlyContinue'
$roots = 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall','HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall','HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall'
$items = foreach ($root in $roots) { Get-ChildItem -LiteralPath $root | ForEach-Object { $p = Get-ItemProperty -LiteralPath $_.PSPath
  [pscustomobject]@{ Key=$_.PSChildName; DisplayName=$p.DisplayName; Publisher=$p.Publisher; InstallLocation=$p.InstallLocation; DisplayIcon=$p.DisplayIcon; UninstallString=$p.UninstallString; SystemComponent=$p.SystemComponent; ParentKeyName=$p.ParentKeyName } } }
[Console]::OutputEncoding = [Text.Encoding]::UTF8
ConvertTo-Json -InputObject @($items) -Compress -Depth 3"#;
        let Ok(output) = hidden_command("powershell.exe").args(["-NoProfile", "-NonInteractive", "-Command", SCRIPT]).output() else { return Vec::new() };
        let entries: Vec<UninstallEntry> = serde_json::from_slice(&output.stdout).unwrap_or_default();
        let (windows, steam_games) = Rules::system_folders();
        let games_roots = game_roots();
        let catalog = catalog_game_keys();
        let mut found: Vec<DetectedProgram> = entries.into_iter().filter_map(|entry| detected(entry, &games_roots, &steam_games, &windows, &catalog)).collect();
        found.sort_by_key(|program| (program.kind.clone(), program.name.to_lowercase()));
        found.dedup_by(|next, kept| norm(&next.folder) == norm(&kept.folder));
        found
    }).await.unwrap_or_default()
}

/// Game Access's own game folders (HKLM\Software\gameAccess GamesDir, and the usual ones).
fn game_roots() -> Vec<String> {
    let mut roots = Vec::new();
    if let Ok(output) = hidden_command("reg").args(["query", r"HKLM\Software\gameAccess", "/v", "GamesDir", "/reg:64"]).output() {
        let text = String::from_utf8_lossy(&output.stdout);
        if let Some(value) = text.lines().find(|line| line.contains("GamesDir")).and_then(|line| line.split("REG_SZ").nth(1)) { roots.push(value.trim().to_string()); }
    }
    roots.retain(|root| !root.is_empty());
    roots
}

/// Whether kid mode was set up in the new model (the parent's key wakes up then, admin_key.rs).
pub fn set_up() -> bool { read_config().is_some() }

#[cfg(test)]
mod tests {
    use super::*;
    use crate::kid_mode::{Kid, KidGame};

    fn rules() -> Rules {
        let config = Restriction {
            enabled: true,
            kid: Kid { games: vec![KidGame { app_id: 311690, name: "Enter the Gungeon".into(), folder: r"C:\juegos\311690-Enter the Gungeon-ready".into(), ..Default::default() },
                                   KidGame { app_id: 620, name: "Portal 2".into(), folder: r"D:\SteamLibrary\steamapps\common\Portal 2".into(), steam: true, ..Default::default() }], ..Default::default() },
            allowed_exes: vec![KnownExe { exe: "Discord.exe".into(), marks: vec!["discord".into()] }, KnownExe { exe: "chrome.exe".into(), marks: vec!["google chrome".into()] }],
            blocked_exes: vec![KnownExe { exe: "notepad.exe".into(), marks: vec!["notepad".into()] }, KnownExe { exe: "msedge.exe".into(), marks: vec!["microsoft edge".into()] }],
            programs: vec![AllowedProgram { name: "Blender".into(), folder: r"C:\Program Files\Blender Foundation\Blender 4.2".into() },
                           AllowedProgram { name: "Blender (Steam)".into(), folder: r"D:\SteamLibrary\steamapps\common\Blender".into() }],
            ..Default::default()
        };
        Rules { props: fake_properties, ..Rules::new(&config, vec![r"C:\Windows".into(), r"C:\Program Files\Microsoft Office".into(), r"C:\Program Files\gameAccess".into(), r"C:\Program Files (x86)\Steam".into()],
                   vec![r"C:\Program Files (x86)\Steam\steamapps".into(), r"D:\SteamLibrary\steamapps".into()]) }
    }

    /// What the test executables say about themselves: the real program, or a game renamed after one.
    fn fake_properties(path: &str) -> Properties {
        let lower = path.to_lowercase();
        let (original, text) = if lower.contains("renamed") { ("hades.exe", "hades supergiant games") }
            else if lower.ends_with("discord.exe") { ("discord.exe", "discord discord inc.") }
            else if lower.ends_with("chrome.exe") { ("chrome.exe", "google chrome google llc") }
            else if lower.ends_with("node.exe") { ("node.exe", "node.js node.js javascript runtime") }
            else if lower.ends_with("notepad.exe") || lower.ends_with("bloc.exe") { ("notepad.exe", "bloc de notas notepad microsoft") }
            else if lower.ends_with("msedge.exe") { ("msedge.exe", "microsoft edge") }
            else { ("", "") };
        Properties { original: original.into(), text: format!("{original} {text}") }
    }

    #[test]
    fn the_childs_games_and_what_they_open_run() {
        let rules = rules();
        assert_eq!(rules.classify(r"C:\juegos\311690-Enter the Gungeon-ready\Enter The Gungeon\EtG.exe", None), Verdict::Game(311690));
        assert_eq!(rules.classify(r"d:/steamlibrary/STEAMAPPS/common/Portal 2/portal2.exe", None), Verdict::Game(620));
        // An anti-cheat the game opens, from anywhere.
        assert_eq!(rules.classify(r"C:\Program Files (x86)\EasyAntiCheat\EasyAntiCheat.exe", Some(620)), Verdict::Game(620));
    }

    #[test]
    fn windows_microsoft_game_access_steam_and_ticked_programs_run() {
        let rules = rules();
        for path in [r"C:\Windows\explorer.exe", r"C:\Windows\System32\calc.exe", r"C:\Program Files\Microsoft Office\root\Office16\WINWORD.EXE",
                     r"C:\Program Files\gameAccess\gameaccess-desktop.exe", r"C:\Program Files (x86)\Steam\steam.exe",
                     r"C:\Program Files (x86)\Steam\bin\cef\cef.win7x64\steamwebhelper.exe", r"C:\Program Files\Blender Foundation\Blender 4.2\blender.exe",
                     r"D:\SteamLibrary\steamapps\common\Blender\blender.exe",
                     // Game Access's own tools and plugins, and programming tools and servers (by Seba's choice).
                     r"C:\Users\Seba\AppData\Local\GameAccess\tools\depotdownloader-3.4.0\DepotDownloader.exe",
                     r"C:\Users\Seba\AppData\Roaming\GameAccess\plugins\ga-torrent-provider\Game Access Torrent Provider.exe",
                     r"C:\Program Files\nodejs\node.exe", r"C:\Program Files\Git\cmd\git.exe", r"C:\Program Files\GitHub CLI\gh.exe",
                     r"C:\Users\Seba\.cargo\bin\cargo.exe", r"C:\DEV\Game Access Dev\apps\api\.venv\Scripts\python.exe",
                     r"C:\DEV\Game Access Dev\apps\desktop\node_modules\@esbuild\win32-x64\esbuild.exe",
                     r"C:\DEV\Game Access Dev\apps\desktop\src-tauri\target\debug\gameaccess-desktop.exe",
                     r"C:\Users\Seba\scoop\apps\rustup\current\.cargo\bin\rustc.exe", r"C:\Users\Seba\.local\bin\claude.exe",
                     r"C:\Users\Seba\AppData\Roaming\Claude\claude-code\2.1.309\9078b9c1d466\claude.exe",
                     r"C:\Users\Seba\AppData\Local\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\Claude-NativeHost\4.4212.0\chrome-native-host.exe",
                     r"C:\Program Files\WindowsApps\Claude_4.4212.0.0_x64__pzs8sxrjxfjjc\app\Claude.exe",
                     r"C:\Users\Seba\AppData\Local\Microsoft\OneDrive\OneDrive.exe"] {
            assert_eq!(rules.classify(path, None), Verdict::Allow, "{path}");
        }
    }

    #[test]
    fn common_programs_go_by_their_name() {
        let rules = rules();
        // On by name, wherever they are installed.
        assert_eq!(rules.classify(r"C:\Users\Seba\AppData\Local\Discord\app-1.0.9\Discord.exe", None), Verdict::Allow);
        assert_eq!(rules.classify(r"D:\Portable\Chrome\chrome.exe", None), Verdict::Allow);
        // Off: closed even inside Windows.
        assert_eq!(rules.classify(r"C:\Windows\System32\notepad.exe", None), Verdict::Block { game: false });
        assert_eq!(rules.classify(r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe", None), Verdict::Block { game: false });
        // Programming tools by name, anywhere.
        assert_eq!(rules.classify(r"E:\tools\node-v24\node.exe", None), Verdict::Allow);
        // A game renamed after an allowed program: its properties still say what it is.
        assert_eq!(rules.classify(r"D:\renamed\chrome.exe", None), Verdict::Block { game: false });
        // A blocked program renamed: its original name still says what it is.
        assert_eq!(rules.classify(r"D:\copies\bloc.exe", None), Verdict::Block { game: false });
        // The child's own game is still the child's, whatever it is called.
        assert_eq!(rules.classify(r"C:\juegos\311690-Enter the Gungeon-ready\notepad.exe", None), Verdict::Game(311690));
    }

    #[test]
    fn other_games_and_programs_are_closed() {
        let rules = rules();
        // A Steam game not assigned to the child, even though it is under Steam's own folder.
        assert_eq!(rules.classify(r"C:\Program Files (x86)\Steam\steamapps\common\Hades\x64\Hades.exe", None), Verdict::Block { game: true });
        assert_eq!(rules.classify(r"D:\SteamLibrary\steamapps\common\Noita\noita.exe", None), Verdict::Block { game: true });
        // A Game Access folder of a game that is not the child's.
        assert_eq!(rules.classify(r"C:\juegos\881100-Noita-ready\noita.exe", None), Verdict::Block { game: true });
        // Something downloaded: closed, and not taken for a game.
        assert_eq!(rules.classify(r"C:\Users\Seba\Downloads\setup_tool.exe", None), Verdict::Block { game: false });
        // A folder that only starts like an allowed one is not inside it.
        assert_eq!(rules.classify(r"C:\Program Files\Blender Foundation\Blender 4.2 Hack\x.exe", None), Verdict::Block { game: false });
    }

    #[test]
    fn installed_programs_are_sorted_into_programs_games_and_windows() {
        let entry = |key: &str, name: &str, publisher: &str, location: &str, icon: &str| UninstallEntry {
            key: key.into(), name: Some(name.into()), publisher: Some(publisher.into()), location: Some(location.into()), icon: Some(icon.into()), ..Default::default() };
        let windows = vec![r"C:\Windows".to_string()];
        let steam = vec![r"D:\SteamLibrary\steamapps".to_string()];
        let roots = vec![r"C:\juegos_GameAccess".to_string()];
        let catalog: std::collections::HashSet<String> = ["Crusader Kings III", "ASTRONEER", "Grip: Combat Racing"].iter().map(|name| name_key(name)).collect();
        let kind = |entry| detected(entry, &roots, &steam, &windows, &catalog).map(|found| (found.kind, found.folder));
        assert_eq!(kind(entry("Blender", "Blender", "Blender Foundation", r"C:\Program Files\Blender Foundation\Blender 4.2\", "")),
                   Some(("program".into(), r"C:\Program Files\Blender Foundation\Blender 4.2".into())));
        assert_eq!(kind(entry("Steam App 620", "Portal 2", "Valve", r"D:\SteamLibrary\steamapps\common\Portal 2", "")).unwrap().0, "game");
        assert_eq!(kind(entry("x", "Noita", "", r"C:\juegos_GameAccess\881100-Noita-ready", "")).unwrap().0, "game");
        assert_eq!(kind(entry("x", "Microsoft 365", "Microsoft Corporation", r"C:\Program Files\Microsoft Office", "")).unwrap().0, "windows");
        // No folder: taken from its icon; an msiexec uninstaller says nothing.
        assert_eq!(kind(entry("x", "7-Zip", "Igor Pavlov", "", r#""C:\Program Files\7-Zip\7zFM.exe",0"#)).unwrap().1, r"C:\Program Files\7-Zip");
        assert_eq!(kind(UninstallEntry { key: "x".into(), name: Some("Driver".into()), uninstall: Some("MsiExec.exe /X{123}".into()), ..Default::default() }), None);
        // Catalog games installed by hand or by a repack, and game stores.
        assert_eq!(kind(entry("x", "Crusader Kings 3", "Paradox", r"D:\Paradox\CK3", "")).unwrap().0, "game");
        assert_eq!(kind(entry("x", "GRIP Combat Racing MULTi10 - ElAmigos versión 1.5.0", "ElAmigos", r"C:\GRIP", "")).unwrap().0, "game");
        assert_eq!(kind(entry("x", "ASTRONEER", "", r"C:\games\ASTRONEER", "")).unwrap().0, "game");
        assert_eq!(kind(entry("x", "Battle.net", "Blizzard", r"C:\Program Files (x86)\Battle.net", "")).unwrap().0, "launcher");
        assert_eq!(kind(entry("x", "Epic Games Launcher", "Epic", r"C:\Program Files (x86)\Epic Games\Launcher", "")).unwrap().0, "launcher");
        assert_eq!(kind(entry("x", "Krita (x64) 5.3.3", "KDE", r"C:\Program Files\Krita (x64)", "")).unwrap().0, "program");
        // Updates and hidden components are not shown.
        assert_eq!(kind(UninstallEntry { parent: Some("Office".into()), ..entry("x", "Update", "", r"C:\a\b", "") }), None);
    }

    /// Reads this PC's real list (run by hand: `cargo test restrictor -- --ignored --nocapture`).
    #[cfg(windows)]
    #[test]
    #[ignore]
    fn lists_this_pcs_programs() {
        let found = tauri::async_runtime::block_on(restriction_programs());
        for kind in ["program", "game", "launcher", "windows"] {
            let names: Vec<&str> = found.iter().filter(|item| item.kind == kind).map(|item| item.name.as_str()).collect();
            println!("{kind} ({}): {}", names.len(), names.join(" | "));
        }
        assert!(!found.is_empty());
    }

    #[cfg(windows)]
    #[test]
    fn closes_what_is_not_allowed_and_leaves_the_rest() {
        // The real loop over the real processes: a copy of a Windows program in a temporary folder is not allowed.
        let root = std::env::temp_dir().join(format!("ga-restrictor-{}", uuid::Uuid::new_v4()));
        let settings = root.join("settings");
        let blocked = root.join("tools");
        std::fs::create_dir_all(&settings).unwrap();
        std::fs::create_dir_all(&blocked).unwrap();
        std::env::set_var("GAMEACCESS_RESTRICTION_DIR", &settings);
        let config = Restriction { version: 1, enabled: true, ..Default::default() };
        std::fs::write(settings.join("config.json"), serde_json::to_string(&config).unwrap()).unwrap();
        let copy = blocked.join("waiter.exe");
        std::fs::copy(std::path::Path::new(&std::env::var("SystemRoot").unwrap()).join("System32").join("PING.EXE"), &copy).unwrap();
        let mut watcher = Watcher { only_children_of: Some(std::process::id()), ..Watcher::new(true) };
        watcher.tick(); // the baseline: this test and everything open now stay
        let mut child = std::process::Command::new(&copy).args(["-n", "30", "127.0.0.1"]).stdout(std::process::Stdio::null()).spawn().unwrap();
        let mut allowed = std::process::Command::new(std::path::Path::new(&std::env::var("SystemRoot").unwrap()).join("System32").join("PING.EXE"))
            .args(["-n", "30", "127.0.0.1"]).stdout(std::process::Stdio::null()).spawn().unwrap();
        // `notify` would open Game Access; as a "service" with no user token here it does nothing.
        // First with the parent in parent mode: nothing is closed.
        std::fs::write(settings.join("padre.json"), serde_json::json!({ "at": now_ms() }).to_string()).unwrap();
        watcher.tick();
        std::thread::sleep(Duration::from_millis(300));
        assert!(child.try_wait().unwrap().is_none(), "paused while the parent is in parent mode");
        // The parent leaves: kid mode restricts again; the copy started before is part of the baseline, so a new one is run.
        std::fs::remove_file(settings.join("padre.json")).unwrap();
        watcher.tick();
        let _ = child.kill();
        let mut child = std::process::Command::new(&copy).args(["-n", "30", "127.0.0.1"]).stdout(std::process::Stdio::null()).spawn().unwrap();
        watcher.tick();
        let closed = (0..20).any(|_| { std::thread::sleep(Duration::from_millis(100)); child.try_wait().ok().flatten().is_some() });
        assert!(closed, "the copy outside the allow list is closed");
        assert!(allowed.try_wait().unwrap().is_none(), "Windows' own one keeps running");
        let _ = allowed.kill();
        let blocks: Vec<Block> = serde_json::from_str(&std::fs::read_to_string(settings.join("bloqueos.json")).unwrap()).unwrap();
        assert_eq!(blocks[0].name.to_lowercase(), "waiter");
        std::env::remove_var("GAMEACCESS_RESTRICTION_DIR");
        let _ = std::fs::remove_dir_all(&root);
    }
}
