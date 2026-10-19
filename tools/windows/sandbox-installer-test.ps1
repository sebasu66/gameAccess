<#
  Installs a GameAccess installer inside Windows Sandbox (a clean, disposable Windows) and checks that it works
  without anything this development machine has installed (Python, Node, Rust, VC++ runtimes, the checkout).

  Inside the sandbox: silent install, `--self-test` (launcher, embedded Python, catalog seed), then the app is
  opened like a player would and left running for -RunSeconds so it can sync the catalog and plugin sources.
  The logs come back to -OutDir. The sandbox is closed at the end and leaves nothing behind.

  .\tools\windows\sandbox-installer-test.ps1                    # newest installer in the Tauri bundle folder
  .\tools\windows\sandbox-installer-test.ps1 -Installer X.exe   # a given installer (for example a downloaded release)
#>
[CmdletBinding()]
param(
    [string]$Installer,
    [string]$OutDir,
    [ValidateRange(30, 3600)][int]$RunSeconds = 180,
    [ValidateRange(5, 120)][int]$TimeoutMinutes = 30
)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)

if (-not $Installer) {
    $bundle = Join-Path $projectRoot 'apps\desktop\src-tauri\target\release\bundle\nsis'
    $found = Get-ChildItem -LiteralPath $bundle -Filter '*-setup.exe' -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if (-not $found) { throw "No installer found in $bundle. Build one first or pass -Installer." }
    $Installer = $found.FullName
}
$Installer = (Resolve-Path -LiteralPath $Installer).Path
if (-not (Test-Path "$env:windir\System32\WindowsSandbox.exe")) {
    throw 'Windows Sandbox is not enabled (Windows Features > "Windows Sandbox").'
}
if (Get-Process -Name 'WindowsSandbox*' -ErrorAction SilentlyContinue) {
    throw 'A Windows Sandbox is already open; only one can run at a time. Close it first.'
}

$work = Join-Path $env:TEMP ('gameaccess-sandbox-' + [DateTime]::Now.ToString('yyyyMMdd-HHmmss'))
$inbox = Join-Path $work 'in'
if (-not $OutDir) { $OutDir = Join-Path $work 'out' }
New-Item -ItemType Directory -Force -Path $inbox, $OutDir | Out-Null
Copy-Item -LiteralPath $Installer -Destination (Join-Path $inbox 'GameAccess-setup.exe')

# Runs inside the sandbox at logon.
@"
`$ErrorActionPreference = 'Continue'
`$out = 'C:\out'
Start-Transcript -Path "`$out\sandbox-transcript.txt" | Out-Null
`$target = 'C:\GameAccess'
Write-Host 'Installing silently...'
`$t = Get-Date
`$install = Start-Process 'C:\in\GameAccess-setup.exe' -ArgumentList '/S', "/D=`$target" -Wait -PassThru
Write-Host "Installer exit: `$(`$install.ExitCode) in `$([int]((Get-Date) - `$t).TotalSeconds) s"
Get-ChildItem `$target -Recurse -File | Measure-Object Length -Sum | ForEach-Object { Write-Host "Installed files: `$(`$_.Count), `$([int](`$_.Sum / 1MB)) MB" }
`$exe = Join-Path `$target 'gameaccess-desktop.exe'
if (Test-Path `$exe) {
    `$env:GAMEACCESS_SELF_TEST_OUT = "`$out\self-test.json"
    `$test = Start-Process `$exe -ArgumentList '--self-test' -Wait -PassThru
    Write-Host "Self-test exit: `$(`$test.ExitCode)"
    Remove-Item Env:GAMEACCESS_SELF_TEST_OUT
    Write-Host 'Opening the app like a player for $RunSeconds s...'
    `$app = Start-Process `$exe -PassThru
    # Screenshots of the first seconds: the startup preparation dialog, the welcome, the library.
    Add-Type -AssemblyName System.Windows.Forms, System.Drawing
    # Without this, a scaled display (125-150 %) is captured only in part.
    Add-Type 'using System.Runtime.InteropServices; public class GaDpi { [DllImport("user32.dll")] public static extern bool SetProcessDPIAware(); }'
    [void][GaDpi]::SetProcessDPIAware()
    `$shotAt = @(3, 8, 15, 30, 60)
    `$waited = 0
    foreach (`$second in `$shotAt) {
        if (`$second -ge $RunSeconds) { break }
        Start-Sleep -Seconds (`$second - `$waited); `$waited = `$second
        `$bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
        `$bitmap = New-Object System.Drawing.Bitmap `$bounds.Width, `$bounds.Height
        [System.Drawing.Graphics]::FromImage(`$bitmap).CopyFromScreen(`$bounds.Location, [System.Drawing.Point]::Empty, `$bounds.Size)
        `$bitmap.Save("`$out\screen-`$('{0:d2}' -f `$second)s.png"); `$bitmap.Dispose()
    }
    Start-Sleep -Seconds ([Math]::Max(0, $RunSeconds - `$waited))
    `$alive = -not `$app.HasExited
    Write-Host "App still running after $RunSeconds s: `$alive"
    Get-Process | Where-Object { `$_.Path -like "`$target*" } | ForEach-Object { Write-Host "  process: `$(`$_.Name) `$([int](`$_.WorkingSet64 / 1MB)) MB" }
} else {
    Write-Host 'The installer did not create gameaccess-desktop.exe'
}
foreach (`$logs in @("`$env:LOCALAPPDATA\GameAccess\logs", "`$target\runtime\launcher\logs")) {
    if (Test-Path `$logs) { Copy-Item `$logs -Destination (Join-Path `$out ((Split-Path `$logs -Parent | Split-Path -Leaf) + '-logs')) -Recurse -Force }
}
Get-ChildItem "`$env:LOCALAPPDATA\GameAccess" -Recurse -File -ErrorAction SilentlyContinue | Select-Object FullName, Length | Format-Table -AutoSize | Out-String -Width 300 | Set-Content "`$out\appdata-files.txt"
Stop-Transcript | Out-Null
Set-Content "`$out\done.txt" 'done'
"@ | Set-Content -LiteralPath (Join-Path $inbox 'run.ps1') -Encoding UTF8

$wsb = Join-Path $work 'gameaccess.wsb'
@"
<Configuration>
  <Networking>Enable</Networking>
  <MappedFolders>
    <MappedFolder><HostFolder>$inbox</HostFolder><SandboxFolder>C:\in</SandboxFolder><ReadOnly>true</ReadOnly></MappedFolder>
    <MappedFolder><HostFolder>$OutDir</HostFolder><SandboxFolder>C:\out</SandboxFolder><ReadOnly>false</ReadOnly></MappedFolder>
  </MappedFolders>
  <LogonCommand><Command>powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\in\run.ps1</Command></LogonCommand>
</Configuration>
"@ | Set-Content -LiteralPath $wsb -Encoding UTF8

Write-Host "Installer: $Installer"
Write-Host "Starting Windows Sandbox (results in $OutDir)..."
Start-Process $wsb
$deadline = (Get-Date).AddMinutes($TimeoutMinutes)
while (-not (Test-Path (Join-Path $OutDir 'done.txt'))) {
    if ((Get-Date) -gt $deadline) { throw "The sandbox run did not finish within $TimeoutMinutes minutes. Partial results: $OutDir" }
    Start-Sleep -Seconds 5
}
Get-Process -Name 'WindowsSandbox*' -ErrorAction SilentlyContinue | Stop-Process -Force

Write-Host ''
Get-Content (Join-Path $OutDir 'sandbox-transcript.txt') | Where-Object { $_ -notmatch '^\*{5,}|^(Start|End) time|^Username|^RunAs|^Configuration|^Machine|^Host Application|^Process ID|^PS(Version|Edition|Compatible|RemotingProtocol)|^(BuildVersion|CLRVersion|WSManStack|SerializationVersion)|^Windows PowerShell transcript' }
$report = Join-Path $OutDir 'self-test.json'
if (Test-Path $report) {
    $result = Get-Content $report -Raw | ConvertFrom-Json
    Write-Host "Self-test: ok=$($result.ok) version=$($result.version) channel=$($result.channel)"
    if (-not $result.ok) { $result.failures | ForEach-Object { Write-Host "  - $_" } ; exit 1 }
} else {
    Write-Host 'No self-test report: the app did not run inside the sandbox.'
    exit 1
}
Write-Host "Logs: $OutDir"
