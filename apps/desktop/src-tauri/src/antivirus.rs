//! The antivirus and the direct-download folders (antivirusExclusion.ts decides what to show). A game's fix or crack
//! is sometimes flagged as a threat although it is not one, and the antivirus deletes a DLL or an .exe so the game no
//! longer starts; Microsoft Defender can be told to leave the games folder and the temporary downloads folder alone.
//! `antivirus_probe` only reads (no administrator rights): which antivirus is on, the exclusions Windows lets it see,
//! and the record `defender-exclusion.ps1` leaves in the registry. `antivirus_add_exclusions` runs that script after
//! one Windows permission question; `antivirus_open_settings` opens Windows Security's virus protection settings.

use serde_json::Value;
use std::path::PathBuf;
use std::process::Command;
#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// What Windows tells an account without administrator rights. A standard account (and an administrator's app,
/// which is not elevated) reads "N/A: Must be an administrator to view exclusions" instead of the exclusions: then
/// `exclusions` is null and the registry record (`recorded`) is what is known.
const PROBE: &str = r#"
$ErrorActionPreference = 'SilentlyContinue'
$products = @(Get-CimInstance -Namespace root/SecurityCenter2 -ClassName AntiVirusProduct | ForEach-Object { [pscustomobject]@{ name = [string]$_.displayName; state = [int64]$_.productState } })
$pref = Get-MpPreference
$found = @($pref.ExclusionPath | Where-Object { $_ })
$exclusions = if ($pref -and -not ($found | Where-Object { $_ -like 'N/A*' })) { @($found | ForEach-Object { [Environment]::ExpandEnvironmentVariables($_) }) } else { $null }
$policy = 'HKLM:\SOFTWARE\Policies\Microsoft\Windows Defender'
$policyPaths = @((Get-Item "$policy\Exclusions\Paths").Property | Where-Object { $_ } | ForEach-Object { [Environment]::ExpandEnvironmentVariables($_) })
$merge = ((Get-ItemProperty -Path $policy -Name DisableLocalAdminMerge).DisableLocalAdminMerge -eq 1)
$machine = [Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::LocalMachine, [Microsoft.Win32.RegistryView]::Registry64)
$key = $machine.OpenSubKey('Software\gameAccess')
$recorded = @(if ($key) { ([string]$key.GetValue('DefenderExclusions', '')) -split '\|' | Where-Object { $_ } })
$mode = [string](Get-MpComputerStatus).AMRunningMode
[pscustomobject]@{ products = $products; exclusions = $exclusions; policyExclusions = $policyPaths; localMergeDisabled = $merge; recorded = $recorded; defenderMode = $mode } | ConvertTo-Json -Depth 4 -Compress
"#;

fn log(level: &str, message: String) {
    let _ = crate::activity_log::append_narration_lines(vec![message], "ANTIVIRUS".into(), level.into());
}

fn powershell(args: &[&str]) -> std::io::Result<std::process::Output> {
    let mut command = Command::new("powershell.exe");
    command.args(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass"]).args(args);
    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);
    command.output()
}

#[tauri::command]
pub async fn antivirus_probe() -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let output = powershell(&["-Command", PROBE]).map_err(|error| error.to_string())?;
        let text = String::from_utf8_lossy(&output.stdout);
        serde_json::from_str::<Value>(text.trim()).map_err(|error| format!("probe: {error}"))
    }).await.map_err(|error| error.to_string())?
}

fn script_path() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    exe.ancestors().flat_map(|root| [root.join("runtime").join("defender-exclusion.ps1"), root.join("tools").join("windows").join("defender-exclusion.ps1")])
        .find(|path| path.is_file())
}

/// A folder as the script receives it: absolute, and without the characters that would break its quoting.
fn usable(path: &str) -> bool {
    let path = path.trim();
    path.len() > 3 && path.as_bytes().get(1) == Some(&b':') && !path.contains(['"', '|', '`', '$'])
}

/// Adds the folders to Microsoft Defender's exclusions: Windows asks for permission once, the script adds the
/// missing ones, reads them back and answers `{added, already, failed, managed, error}`. "cancelled" when the
/// person says no to Windows' question.
#[tauri::command]
pub async fn antivirus_add_exclusions(paths: Vec<String>) -> Result<Value, String> {
    let paths: Vec<String> = paths.into_iter().map(|path| path.trim().to_string()).filter(|path| usable(path)).collect();
    if paths.is_empty() { return Err("no_paths".into()); }
    let Some(script) = script_path() else { return Err("missing_script".into()); };
    tauri::async_runtime::spawn_blocking(move || {
        let result = std::env::temp_dir().join(format!("gameaccess-defender-{}.json", uuid::Uuid::new_v4()));
        log("INFO", format!("Asking Windows for permission to exclude {} from Microsoft Defender.", paths.join(", ")));
        let inner = format!("-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File \"{}\" -Paths \"{}\" -Result \"{}\"", script.display(), paths.join("|"), result.display());
        let outer = format!("$p = Start-Process powershell -Verb RunAs -Wait -PassThru -WindowStyle Hidden -ArgumentList '{}'; exit $p.ExitCode", inner.replace('\'', "''"));
        let output = powershell(&["-Command", &outer]).map_err(|error| error.to_string())?;
        let answer = std::fs::read_to_string(&result).ok();
        let _ = std::fs::remove_file(&result);
        match answer.and_then(|text| serde_json::from_str::<Value>(text.trim_start_matches('\u{feff}').trim()).ok()) {
            Some(value) => { log("INFO", format!("Defender exclusions: {value}")); Ok(value) }
            None => {
                let said = String::from_utf8_lossy(&output.stderr).split_whitespace().collect::<Vec<_>>().join(" ");
                // Start-Process fails this way when the person says no to Windows' permission question.
                if said.contains("canceled by the user") || said.contains("cancelada por el usuario") || said.contains("cancelado por el usuario") {
                    log("WARN", "The person said no to Windows' permission question.".into());
                    return Err("cancelled".into());
                }
                log("ERROR", format!("The exclusion script gave no answer (code {:?}): {said}", output.status.code()));
                Err(if said.is_empty() { "script_failed".into() } else { said })
            }
        }
    }).await.map_err(|error| error.to_string())?
}

#[tauri::command]
pub fn antivirus_open_settings() -> Result<(), String> {
    Command::new("explorer.exe").arg("windowsdefender://threatsettings").spawn().map(|_| ()).map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::usable;

    #[test]
    fn only_plain_absolute_folders_reach_the_script() {
        assert!(usable(r"C:\GA_Juegos"));
        assert!(usable(r"D:\Users\Ana Pérez\Downloads\GameAccessDownloads"));
        assert!(!usable(r"C:\"));
        assert!(!usable(r"games"));
        assert!(!usable(r#"C:\a" -Result "x"#));
        assert!(!usable(r"C:\a|C:\b"));
        assert!(usable(r"C:\Users\O'Brien\Downloads\GameAccessDownloads"));
        assert!(!usable(r"C:\$env:x"));
    }
}
