$ErrorActionPreference = 'Stop'
$GodotDir = Split-Path -Parent $PSScriptRoot
$DesktopDir = [IO.Path]::GetFullPath((Join-Path $GodotDir '../desktop'))
$TauriDir = Join-Path $DesktopDir 'src-tauri'
$DistIndex = Join-Path $DesktopDir 'dist/index.html'
$needsUiBuild = -not (Test-Path $DistIndex)
if (-not $needsUiBuild) {
    $distTime = (Get-Item $DistIndex).LastWriteTimeUtc
    $newer = Get-ChildItem (Join-Path $DesktopDir 'src') -Recurse -File | Where-Object { $_.LastWriteTimeUtc -gt $distTime } | Select-Object -First 1
    $needsUiBuild = $null -ne $newer
}
if ($needsUiBuild) {
    Push-Location $DesktopDir
    try { & npm.cmd run build; if ($LASTEXITCODE -ne 0) { throw "Vite build failed: $LASTEXITCODE" } } finally { Pop-Location }
}
& cargo.exe build --manifest-path (Join-Path $TauriDir 'Cargo.toml') --bin gameaccess-runtime
if ($LASTEXITCODE -ne 0) { throw "Runtime build failed: $LASTEXITCODE" }
