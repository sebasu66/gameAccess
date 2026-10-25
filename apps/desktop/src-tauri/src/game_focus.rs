//! Focus around a game session: the game's window takes the focus when it appears, and when the game ends Game Access
//! comes back to the front (the front end then puts the focus on the game grid, ready for the controller).
//!
//! A game is followed by its install folder, not by one process id: launchers start the real game and exit, and Steam
//! games are started by Steam. Every process whose executable lives under the folder counts as the game; once one was
//! seen and none is left, the session is over. Windows only lets the foreground app hand the focus over, so the
//! focus moves by attaching to the input of the window that has it now. Windows APIs are called directly from their
//! system DLLs, with no extra crate.

use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};

/// Each new session stops the watcher of the previous one.
static SESSION: AtomicU64 = AtomicU64::new(0);
const POLL: Duration = Duration::from_millis(1000);
/// How long a game may take to show up (thawing, a Steam account switch, a launcher).
const APPEAR_TIMEOUT: Duration = Duration::from_secs(240);
/// While this long after it appeared, a new game window (the launcher gave way to the game) takes the focus again.
const FOCUS_WINDOW: Duration = Duration::from_secs(60);

/// Whether `image` (an executable's full path) is inside `folder`, ignoring case and slash style.
fn inside(folder: &str, image: &str) -> bool {
    let norm = |value: &str| value.replace('/', "\\").trim_end_matches('\\').to_lowercase();
    let (folder, image) = (norm(folder), norm(image));
    !folder.is_empty() && image.starts_with(&folder) && image[folder.len()..].starts_with('\\')
}

#[cfg(windows)]
#[allow(non_snake_case, clippy::upper_case_acronyms)]
mod win {
    use std::ffi::c_void;
    pub type HWND = isize;
    pub type HANDLE = *mut c_void;

    #[repr(C)]
    pub struct PROCESSENTRY32W {
        pub dwSize: u32, pub cntUsage: u32, pub th32ProcessID: u32, pub th32DefaultHeapID: usize, pub th32ModuleID: u32,
        pub cntThreads: u32, pub th32ParentProcessID: u32, pub pcPriClassBase: i32, pub dwFlags: u32, pub szExeFile: [u16; 260],
    }

    #[link(name = "kernel32", kind = "raw-dylib")]
    extern "system" {
        pub fn CreateToolhelp32Snapshot(flags: u32, pid: u32) -> HANDLE;
        pub fn Process32FirstW(snapshot: HANDLE, entry: *mut PROCESSENTRY32W) -> i32;
        pub fn Process32NextW(snapshot: HANDLE, entry: *mut PROCESSENTRY32W) -> i32;
        pub fn OpenProcess(access: u32, inherit: i32, pid: u32) -> HANDLE;
        pub fn QueryFullProcessImageNameW(process: HANDLE, flags: u32, name: *mut u16, size: *mut u32) -> i32;
        pub fn CloseHandle(handle: HANDLE) -> i32;
        pub fn GetCurrentThreadId() -> u32;
    }
    #[link(name = "user32", kind = "raw-dylib")]
    extern "system" {
        pub fn EnumWindows(callback: extern "system" fn(HWND, isize) -> i32, param: isize) -> i32;
        pub fn GetWindowThreadProcessId(window: HWND, pid: *mut u32) -> u32;
        pub fn IsWindowVisible(window: HWND) -> i32;
        pub fn GetWindow(window: HWND, command: u32) -> HWND;
        pub fn GetForegroundWindow() -> HWND;
        pub fn SetForegroundWindow(window: HWND) -> i32;
        pub fn BringWindowToTop(window: HWND) -> i32;
        pub fn ShowWindow(window: HWND, command: i32) -> i32;
        pub fn IsIconic(window: HWND) -> i32;
        pub fn AttachThreadInput(attach: u32, to: u32, on: i32) -> i32;
    }
    pub const TH32CS_SNAPPROCESS: u32 = 0x2;
    pub const PROCESS_QUERY_LIMITED_INFORMATION: u32 = 0x1000;
    pub const GW_OWNER: u32 = 4;
    pub const SW_RESTORE: i32 = 9;
    pub const INVALID_HANDLE_VALUE: HANDLE = -1isize as HANDLE;
}

/// The processes running from `folder`.
#[cfg(windows)]
fn game_processes(folder: &str) -> Vec<u32> {
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
            let process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
            if !process.is_null() {
                let mut buffer = [0u16; 1024];
                let mut size = buffer.len() as u32;
                if QueryFullProcessImageNameW(process, 0, buffer.as_mut_ptr(), &mut size) != 0
                    && inside(folder, &String::from_utf16_lossy(&buffer[..size as usize])) {
                    found.push(pid);
                }
                CloseHandle(process);
            }
            more = Process32NextW(snapshot, &mut entry) != 0;
        }
        CloseHandle(snapshot);
    }
    found
}

/// A visible top-level window (not owned by another one) of these processes.
#[cfg(windows)]
fn game_window(pids: &[u32]) -> Option<win::HWND> {
    use win::*;
    struct Search<'a> { pids: &'a [u32], found: HWND }
    extern "system" fn visit(window: HWND, param: isize) -> i32 {
        let search = unsafe { &mut *(param as *mut Search) };
        let mut pid = 0u32;
        unsafe { GetWindowThreadProcessId(window, &mut pid) };
        if search.pids.contains(&pid) && unsafe { IsWindowVisible(window) } != 0 && unsafe { GetWindow(window, GW_OWNER) } == 0 {
            search.found = window;
            return 0;
        }
        1
    }
    let mut search = Search { pids, found: 0 };
    unsafe { EnumWindows(visit, &mut search as *mut Search as isize) };
    (search.found != 0).then_some(search.found)
}

/// Brings `window` to the front even from the background: attached to the input of the window that has the focus,
/// Windows lets this thread move it.
#[cfg(windows)]
fn force_foreground(window: win::HWND) {
    use win::*;
    unsafe {
        let current = GetForegroundWindow();
        if current == window { return; }
        let theirs = GetWindowThreadProcessId(current, std::ptr::null_mut());
        let ours = GetCurrentThreadId();
        let attached = theirs != 0 && theirs != ours && AttachThreadInput(ours, theirs, 1) != 0;
        if IsIconic(window) != 0 { ShowWindow(window, SW_RESTORE); }
        BringWindowToTop(window);
        SetForegroundWindow(window);
        if attached { AttachThreadInput(ours, theirs, 0); }
    }
}

#[cfg(windows)]
fn foreground_pid() -> u32 {
    let mut pid = 0u32;
    unsafe { win::GetWindowThreadProcessId(win::GetForegroundWindow(), &mut pid) };
    pid
}

#[cfg(windows)]
fn watch(app: AppHandle, folder: String, session: u64) {
    let started = Instant::now();
    let mut appeared: Option<Instant> = None;
    let mut focused: Option<win::HWND> = None;
    let mut empty_polls = 0;
    let ours = std::process::id();
    while SESSION.load(Ordering::SeqCst) == session {
        std::thread::sleep(POLL);
        let pids = game_processes(&folder);
        if pids.is_empty() {
            match appeared {
                None if started.elapsed() > APPEAR_TIMEOUT => return,
                None => continue,
                Some(_) => {
                    // Two polls in a row with nothing left: the game is over (a launcher handing over to the game
                    // leaves no gap that long).
                    empty_polls += 1;
                    if empty_polls < 2 { continue; }
                    if SESSION.load(Ordering::SeqCst) != session { return; }
                    crate::webview_rest::set_game_running(&app, false);
                    if let Some(main) = app.get_webview_window("main") {
                        let _ = main.unminimize();
                        let _ = main.show();
                        if let Ok(handle) = main.hwnd() { force_foreground(handle.0 as win::HWND); }
                        let _ = main.set_focus();
                    }
                    let _ = app.emit("gameaccess:game-ended", folder.clone());
                    return;
                }
            }
        }
        empty_polls = 0;
        if appeared.is_none() { crate::webview_rest::set_game_running(&app, true); }
        let first_seen = *appeared.get_or_insert_with(Instant::now);
        // Give the game's window the focus, again when a new one shows (launcher -> game), as long as the player has
        // not moved somewhere else: the front window is still Game Access or the game.
        if first_seen.elapsed() <= FOCUS_WINDOW {
            if let Some(window) = game_window(&pids) {
                let front = foreground_pid();
                if focused != Some(window) && (front == ours || pids.contains(&front) || front == 0) {
                    force_foreground(window);
                    focused = Some(window);
                }
            }
        }
    }
}

/// Follows the game started from `folder`: its window gets the focus, and when it ends Game Access comes back to the
/// front and emits `gameaccess:game-ended`. A new call replaces the previous session.
#[tauri::command]
pub fn game_focus_watch(app: AppHandle, folder: String) -> bool {
    let session = SESSION.fetch_add(1, Ordering::SeqCst) + 1;
    // A new session replaces the previous one, which may have left the view resting.
    crate::webview_rest::set_game_running(&app, false);
    if folder.trim().is_empty() || !Path::new(&folder).is_dir() { return false; }
    #[cfg(windows)]
    std::thread::spawn(move || watch(app, folder, session));
    #[cfg(not(windows))]
    let _ = (app, session);
    true
}

#[cfg(test)]
mod tests {
    use super::inside;

    #[test]
    fn a_process_belongs_to_the_game_by_its_folder() {
        assert!(inside(r"D:\Games\Hades", r"d:\games\hades\x64\Hades.exe"));
        assert!(inside("D:/Games/Hades/", r"D:\Games\Hades\Hades.exe"));
        assert!(!inside(r"D:\Games\Hades", r"D:\Games\Hades II\Hades2.exe"));
        assert!(!inside("", r"C:\Windows\explorer.exe"));
    }

    #[cfg(windows)]
    #[test]
    fn lists_processes_and_windows_without_crashing() {
        // The real calls, against this machine: a wrong struct layout or signature would fail here, not in the app.
        let windows_dir = std::env::var("SystemRoot").unwrap_or_else(|_| r"C:\Windows".into());
        let pids = super::game_processes(&windows_dir);
        assert!(!pids.is_empty(), "Windows' own processes run from its folder");
        let _ = super::game_window(&pids);
    }
}
