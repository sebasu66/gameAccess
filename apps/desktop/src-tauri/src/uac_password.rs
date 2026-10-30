//! "Ask for the Windows password for administrator tasks" (Seba, 2026-10-30): kid mode's service can be stopped by an
//! administrator, and the child uses the parent's same Windows account, where Windows by default only asks "Yes" for
//! that. With Windows' own policy `ConsentPromptBehaviorAdmin` = 1 it asks for the account's password instead, so
//! stopping the service, uninstalling Game Access or changing its folder's permissions needs the parent's password.
//! It is the parent's choice (it applies to the whole PC); 5 is Windows' default. Changing it needs administrator
//! rights: Windows asks once, and saying no leaves it as it was.
//! Turning it on leaves a note with the app's own data (`uac-password.ours`): turning kid mode off or removing it puts
//! back only what Game Access changed, and a Windows choice the parent made by hand is left alone.
//!
//! It asks for the account's password and not for Windows Hello: the UAC prompt does not accept a PIN or a fingerprint
//! (Seba, 2026-10-30). So this cannot be the lock that a parent opens with Hello; that one lives in the app
//! (vault/Tareas.md MN.21).

use std::path::PathBuf;

const KEY: &str = r"HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System";

fn hidden(program: &str) -> std::process::Command {
    let mut command = std::process::Command::new(program);
    #[cfg(windows)]
    { use std::os::windows::process::CommandExt; command.creation_flags(0x0800_0000); }
    command
}

/// Whether Windows asks for a password (1 on the secure desktop, 3 on the normal one) for administrator tasks.
fn asks_password() -> bool {
    let Ok(output) = hidden("reg").args(["query", KEY, "/v", "ConsentPromptBehaviorAdmin"]).output() else { return false };
    let text = String::from_utf8_lossy(&output.stdout);
    text.lines().find(|line| line.contains("ConsentPromptBehaviorAdmin")).and_then(|line| line.split("0x").nth(1))
        .and_then(|value| u32::from_str_radix(value.trim(), 16).ok()).is_some_and(|value| value == 1 || value == 3)
}

/// The note lives with the app's data of this Windows account; nobody else needs to write it.
fn note() -> Option<PathBuf> {
    std::env::var_os("LOCALAPPDATA").map(|base| PathBuf::from(base).join("gameAccess").join("uac-password.ours"))
}

fn noted() -> bool { note().is_some_and(|path| path.exists()) }

fn write_note(ours: bool) {
    let Some(path) = note() else { return };
    if !ours { let _ = std::fs::remove_file(path); return; }
    if let Some(folder) = path.parent() { let _ = std::fs::create_dir_all(folder); }
    let _ = std::fs::write(path, b"Game Access turned on Windows' password for administrator tasks.\n");
}

/// Writes the policy through Windows' own permission question. `Err("cancelled")` when it was refused.
fn write(on: bool) -> Result<bool, String> {
    let value = if on { 1 } else { 5 };
    let script = format!("Start-Process -FilePath reg.exe -ArgumentList 'add \"{KEY}\" /v ConsentPromptBehaviorAdmin /t REG_DWORD /d {value} /f' -Verb RunAs -Wait -WindowStyle Hidden");
    let output = hidden("powershell.exe").args(["-NoProfile", "-NonInteractive", "-Command", &script]).output().map_err(|error| error.to_string())?;
    if !output.status.success() { return Err("cancelled".to_string()); }
    Ok(asks_password())
}

#[tauri::command]
pub async fn uac_password_state() -> bool { tauri::async_runtime::spawn_blocking(asks_password).await.unwrap_or(false) }

/// Turns it on (1) or back to Windows' default (5); Windows asks for permission. Returns the state afterwards, or
/// "cancelled" when the permission was refused.
#[tauri::command]
pub async fn uac_password_set(on: bool) -> Result<bool, String> {
    let state = tauri::async_runtime::spawn_blocking(move || write(on)).await.map_err(|error| error.to_string())??;
    write_note(on);
    Ok(state)
}

/// Puts it back when kid mode is turned off or removed, and only if Game Access turned it on: a Windows setting the
/// parent chose by hand is not touched. `Ok(false)`: there was nothing of ours to undo.
#[tauri::command]
pub async fn uac_password_undo() -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(|| {
        if !noted() { return Ok(false); }
        write(false)?;
        write_note(false);
        Ok(true)
    }).await.map_err(|error| error.to_string())?
}
