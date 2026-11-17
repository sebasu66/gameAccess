[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$desktop = Join-Path $root 'apps/desktop'
$previousTarget = $env:CARGO_TARGET_DIR
$previousStamp = $env:VITE_BUILD_TIMESTAMP
try {
    $env:CARGO_TARGET_DIR = Join-Path $desktop 'src-tauri/target'
    $env:VITE_BUILD_TIMESTAMP = [DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
    Push-Location $desktop
    try {
        & npm.cmd run tauri -- build
        if ($LASTEXITCODE -ne 0) { throw "Installer build failed: $LASTEXITCODE" }
    } finally { Pop-Location }
    $installer = Get-ChildItem (Join-Path $desktop 'src-tauri/target/release/bundle/nsis/*-setup.exe') | Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1
    if (-not $installer) { throw 'Installer missing.' }
    $seed = Get-Content (Join-Path $root 'deploy/catalog-cache/catalog-manifest.json') -Raw | ConvertFrom-Json
    if (-not $seed.coverage.recent_complete) { throw 'Bundled discovery coverage is incomplete.' }
    $result = @{ installer=$installer.FullName; sha256=(Get-FileHash -LiteralPath $installer.FullName -Algorithm SHA256).Hash; commit=(git -C $root rev-parse HEAD).Trim(); catalog_revision=$seed.revision; catalog_count=$seed.catalog_count; built_at_utc=$env:VITE_BUILD_TIMESTAMP }
    $result | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $root 'GameAccess-discovery-installer.build.json') -Encoding UTF8
    $result | ConvertTo-Json -Compress
} finally {
    $env:CARGO_TARGET_DIR = $previousTarget
    $env:VITE_BUILD_TIMESTAMP = $previousStamp
}
