[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$desktop = Join-Path $root 'apps/desktop'
$source = Join-Path $desktop 'src-tauri/target/release/gameaccess-desktop.exe'
$output = Join-Path $root 'GameAccess-settings-preview.exe'
$previousTarget = $env:CARGO_TARGET_DIR
$previousApi = $env:VITE_GAMEACCESS_API
$previousStamp = $env:VITE_BUILD_TIMESTAMP
try {
    $env:CARGO_TARGET_DIR = Join-Path $desktop 'src-tauri/target'
    $env:VITE_GAMEACCESS_API = 'http://127.0.0.1:38147'
    $env:VITE_BUILD_TIMESTAMP = [DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
    Push-Location $desktop
    try {
        & npm.cmd run tauri -- build --no-bundle
        if ($LASTEXITCODE -ne 0) { throw "Desktop build failed: $LASTEXITCODE" }
    } finally { Pop-Location }
    Copy-Item -LiteralPath $source -Destination $output -Force
    $hash = (Get-FileHash -LiteralPath $output -Algorithm SHA256).Hash
    if ($hash -ne (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash) { throw 'Executable copy hash mismatch.' }
    $result = @{ output_exe = $output; sha256 = $hash; commit = (git -C $root rev-parse HEAD).Trim(); built_at_utc = $env:VITE_BUILD_TIMESTAMP }
    $result | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $root 'GameAccess-settings-preview.build.json') -Encoding UTF8
    $result | ConvertTo-Json -Compress
} finally {
    $env:CARGO_TARGET_DIR = $previousTarget
    $env:VITE_GAMEACCESS_API = $previousApi
    $env:VITE_BUILD_TIMESTAMP = $previousStamp
}
