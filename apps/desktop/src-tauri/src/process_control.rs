//! Processes and the folders they hold (filelocksmith: PowerToys File Locksmith's method in pure Rust).
//!
//! Windows will not rename or move a folder while a program has it open: an Explorer window showing it, a console
//! standing in it, a game still running from it. When the library manager meets that ("in use"), the app asks here who
//! holds the folder and names them in the notice, so the player knows exactly what to close. Explorer windows can be
//! closed from the notice (only the windows on that folder; Explorer itself keeps running). Nothing is killed here.
//!
//! `terminate` closes processes for good (TerminateProcess). It is for kid mode: when the time is up, the game is
//! closed if the child did not close it.

use serde::Serialize;

#[derive(Serialize, Clone, Debug)]
pub struct Locker {
    pid: usize,
    /// The program's file name ("explorer.exe"), or "" when Windows does not let us read it (an elevated process).
    name: String,
    /// "explorer", "console" or "other": what the notice says to do about it.
    kind: &'static str,
}

const CONSOLES: [&str; 6] = ["powershell.exe", "pwsh.exe", "cmd.exe", "windowsterminal.exe", "openconsole.exe", "conhost.exe"];

fn kind_of(name: &str) -> &'static str {
    let name = name.to_lowercase();
    if name == "explorer.exe" { "explorer" } else if CONSOLES.contains(&name.as_str()) { "console" } else { "other" }
}

fn lockers_of(folder: &str) -> Vec<Locker> {
    let ours = std::process::id() as usize;
    let mut pids = filelocksmith::find_processes_locking_path(folder);
    pids.sort_unstable();
    pids.dedup();
    pids.into_iter().filter(|pid| *pid != ours).map(|pid| {
        let name = filelocksmith::pid_to_process_path(pid)
            .and_then(|path| std::path::Path::new(&path).file_name().map(|name| name.to_string_lossy().into_owned()))
            .unwrap_or_default();
        Locker { pid, kind: kind_of(&name), name }
    }).collect()
}

/// Who holds `folder` (or something inside it) open.
#[tauri::command]
pub async fn folder_lockers(folder: String) -> Vec<Locker> {
    tauri::async_runtime::spawn_blocking(move || lockers_of(&folder)).await.unwrap_or_default()
}

/// Closes the Explorer windows showing `folder` or something inside it (Explorer keeps running). Returns how many.
#[tauri::command]
pub async fn close_explorer_windows(folder: String) -> u32 {
    tauri::async_runtime::spawn_blocking(move || close_windows_on(&folder)).await.unwrap_or(0)
}

#[cfg(windows)]
fn close_windows_on(folder: &str) -> u32 {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    // The folder travels in an environment variable, so no quoting can break the script.
    const SCRIPT: &str = r#"
$folder = [IO.Path]::GetFullPath($env:GA_FOLDER).TrimEnd('\')
$closed = 0
foreach ($window in @((New-Object -ComObject Shell.Application).Windows())) {
  try { $path = $window.Document.Folder.Self.Path } catch { continue }
  if ($path -and ($path -ieq $folder -or $path.StartsWith($folder + '\', [StringComparison]::OrdinalIgnoreCase))) { $window.Quit(); $closed++ }
}
$closed
"#;
    std::process::Command::new("powershell.exe")
        .args(["-NoProfile", "-NonInteractive", "-Command", SCRIPT])
        .env("GA_FOLDER", folder)
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .ok()
        .and_then(|output| String::from_utf8_lossy(&output.stdout).trim().parse().ok())
        .unwrap_or(0)
}

#[cfg(not(windows))]
fn close_windows_on(_folder: &str) -> u32 { 0 }

/// Closes these processes for good. For kid mode's time limit (the game is closed when the time is up).
#[allow(dead_code)]
pub fn terminate(pids: Vec<usize>) -> bool {
    filelocksmith::quit_processes(pids)
}

#[cfg(test)]
mod tests {
    use super::kind_of;

    #[test]
    fn says_what_kind_of_program_holds_a_folder() {
        assert_eq!(kind_of("explorer.exe"), "explorer");
        assert_eq!(kind_of("PowerShell.exe"), "console");
        assert_eq!(kind_of("dirtrally2.exe"), "other");
        assert_eq!(kind_of(""), "other");
    }

    #[cfg(windows)]
    #[test]
    fn finds_this_test_holding_a_folder_open() {
        // The real call: a folder this test holds open is found, the test itself excluded (it is "us").
        let dir = std::env::temp_dir().join(format!("ga-lockers-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = std::fs::File::create(dir.join("held.txt")).unwrap();
        let found = filelocksmith::find_processes_locking_path(&dir);
        assert!(found.contains(&(std::process::id() as usize)), "the folder's open file is found: {found:?}");
        drop(file);
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Diagnosis by hand, read-only: `GA_LOCK_CHECK=<folder> cargo test who_holds -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn who_holds_a_real_folder() {
        let folder = std::env::var("GA_LOCK_CHECK").expect("GA_LOCK_CHECK=<folder>");
        println!("{:#?}", super::lockers_of(&folder));
    }
}
