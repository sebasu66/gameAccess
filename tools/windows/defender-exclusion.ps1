<#
  Game Access: keeps Microsoft Defender out of the direct-download folders (the games folder and the temporary
  downloads folder). A game's fix or crack is sometimes flagged as a threat although it is not one, and Defender then
  deletes a DLL or an .exe and the game no longer starts. Steam and linked games live elsewhere and need none of this.

  Runs elevated (the installer is; the app asks Windows for permission once with Start-Process -Verb RunAs):
    -Paths "C:\GA_Juegos|C:\Users\x\Downloads\GameAccessDownloads"   folders separated by "|"
    -Result <file>                                                    where the outcome goes as JSON (the app reads it)

  Each folder already covered by an exclusion (the same folder or one above it) is left alone; the others are added
  with Add-MpPreference and read back. Folders covered afterwards are written to HKLM\Software\gameAccess
  (DefenderExclusions, separated by "|"), which any account can read: without administrator rights Windows answers
  "N/A: Must be an administrator to view exclusions", so that record is how the app knows later.
#>
param(
  [string]$Paths = "",
  [string]$Result = "",
  # Where the record goes; the tests (apps/desktop/src/defenderExclusionScript.test.ts) use CurrentUser and a key of their own.
  [string]$RecordHive = "LocalMachine",
  [string]$RecordKey = "Software\gameAccess"
)
$ErrorActionPreference = "Stop"

function Normalize([string]$path) {
  $expanded = [Environment]::ExpandEnvironmentVariables($path.Trim().Trim('"'))
  ($expanded -replace '/', '\' -replace '\\\*?$', '').ToLowerInvariant()
}

function Covered([string]$path, [string[]]$exclusions) {
  $folder = Normalize $path
  foreach ($exclusion in $exclusions) {
    if (-not $exclusion) { continue }
    $base = Normalize $exclusion
    if ($base -and ($folder -eq $base -or $folder.StartsWith("$base\"))) { return $true }
  }
  return $false
}

function Write-Outcome($outcome) {
  if ($Result) { $outcome | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $Result -Encoding UTF8 }
}

$folders = @($Paths -split '\|' | ForEach-Object { $_.Trim() } | Where-Object { $_ })
$outcome = [ordered]@{ added = @(); already = @(); failed = @(); managed = $false; error = "" }
try {
  # Exclusions an organization sets by policy, and whether it ignores the ones made on this PC.
  $policy = "HKLM:\SOFTWARE\Policies\Microsoft\Windows Defender"
  $outcome.managed = ((Get-ItemProperty -Path $policy -Name DisableLocalAdminMerge -ErrorAction SilentlyContinue).DisableLocalAdminMerge -eq 1)
  $existing = @((Get-MpPreference).ExclusionPath | Where-Object { $_ })
  foreach ($folder in $folders) {
    if (Covered $folder $existing) { $outcome.already += $folder; continue }
    try { Add-MpPreference -ExclusionPath $folder -ErrorAction Stop } catch { $outcome.failed += $folder; $outcome.error = $_.Exception.Message }
  }
  $after = @((Get-MpPreference).ExclusionPath | Where-Object { $_ })
  foreach ($folder in $folders) {
    if ($outcome.already -contains $folder -or $outcome.failed -contains $folder) { continue }
    if (Covered $folder $after) { $outcome.added += $folder } else { $outcome.failed += $folder }
  }
  # The record any account can read (64-bit view: the installer's PowerShell may be the 32-bit one).
  $machine = [Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::$RecordHive, [Microsoft.Win32.RegistryView]::Registry64)
  $key = $machine.CreateSubKey($RecordKey)
  $known = @(($key.GetValue("DefenderExclusions", "") -split '\|') | Where-Object { $_ })
  $ok = @($outcome.added) + @($outcome.already)
  if (-not $outcome.managed -and $ok.Count) {
    $key.SetValue("DefenderExclusions", ((@($known) + $ok | Select-Object -Unique) -join '|'))
  }
  $key.Close()
} catch {
  $outcome.error = $_.Exception.Message
  $outcome.failed = @($folders | Where-Object { $outcome.added -notcontains $_ -and $outcome.already -notcontains $_ })
}
Write-Outcome $outcome
if ($outcome.failed.Count) { exit 1 }
exit 0
