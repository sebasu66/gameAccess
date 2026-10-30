//! "Ask for the Windows password for administrator tasks" (Seba, 2026-10-30): kid mode's service can be stopped by an
//! administrator, and the child uses the parent's same Windows account, where Windows by default only asks "Yes" for
//! that. With Windows' own policy `ConsentPromptBehaviorAdmin` = 1 it asks for the account's password instead, so
//! stopping the service, uninstalling Game Access or changing its folder's permissions needs the parent's password.
//! It is the parent's choice (it applies to the whole PC); 5 is Windows' default. Changing it needs administrator
//! rights: Windows asks once, and saying no leaves it as it was.

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

#[tauri::command]
pub async fn uac_password_state() -> bool { tauri::async_runtime::spawn_blocking(asks_password).await.unwrap_or(false) }

/// Turns it on (1) or back to Windows' default (5); Windows asks for permission. Returns the state afterwards, or
/// "cancelled" when the permission was refused.
#[tauri::command]
pub async fn uac_password_set(on: bool) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let value = if on { 1 } else { 5 };
        let script = format!("Start-Process -FilePath reg.exe -ArgumentList 'add \"{KEY}\" /v ConsentPromptBehaviorAdmin /t REG_DWORD /d {value} /f' -Verb RunAs -Wait -WindowStyle Hidden");
        let output = hidden("powershell.exe").args(["-NoProfile", "-NonInteractive", "-Command", &script]).output().map_err(|error| error.to_string())?;
        if !output.status.success() { return Err("cancelled".to_string()); }
        Ok(asks_password())
    }).await.map_err(|error| error.to_string())?
}
