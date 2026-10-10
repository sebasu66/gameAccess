[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$PluginDirectory)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$target = (Resolve-Path -LiteralPath $PluginDirectory).Path.TrimEnd('\')
if ($target -ne 'C:\DEV\ga-torrent-plugin') { throw 'This deployment script only targets the existing C:\DEV\ga-torrent-plugin installation.' }
$electron = Join-Path $target 'node_modules/electron/dist/electron.exe'
if (-not (Test-Path -LiteralPath $electron)) { throw 'Existing plugin Electron runtime not found.' }
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$files = @('main.js', 'links.js', 'matcher.js')
foreach ($file in $files) {
    $source = Join-Path $root "examples/source-provider/$file"
    $destination = Join-Path $target $file
    if (Test-Path -LiteralPath $destination) {
        Copy-Item -LiteralPath $destination -Destination "$destination.pre-$stamp" -Force
    }
    Copy-Item -LiteralPath $source -Destination $destination -Force
    if ((Get-FileHash -LiteralPath $source).Hash -ne (Get-FileHash -LiteralPath $destination).Hash) { throw "Plugin copy hash mismatch: $file" }
}
$processes = Get-CimInstance Win32_Process -Filter "Name='electron.exe'"
foreach ($process in $processes) {
    if ($process.ExecutablePath -eq $electron -and $process.CommandLine -notmatch '--type=') {
        Stop-Process -Id $process.ProcessId -ErrorAction Stop
    }
}
Start-Sleep -Milliseconds 500
Start-Process -FilePath $electron -ArgumentList ('"' + $target + '"') -WorkingDirectory $target -WindowStyle Hidden
@{ plugin_directory = $target; commit = (git -C $root rev-parse HEAD).Trim(); backed_up_at = $stamp } | ConvertTo-Json -Compress
