[CmdletBinding()]
param()

# Builds the Windows installer (NSIS) and leaves a copy in this folder as GameAccess-Setup-<version>.exe.
# The installer speaks the system language (Spanish or English; other languages fall back to English).
#   .\build-installer.ps1
$ErrorActionPreference = 'Stop'
$projectRoot = $PSScriptRoot

& (Join-Path $projectRoot 'tools\windows\build-discovery-installer.ps1')

$build = Get-Content (Join-Path $projectRoot 'GameAccess-discovery-installer.build.json') -Raw | ConvertFrom-Json
$version = (Get-Content (Join-Path $projectRoot 'apps\desktop\src-tauri\tauri.conf.json') -Raw | ConvertFrom-Json).version
$target = Join-Path $projectRoot "GameAccess-Setup-$version.exe"
Copy-Item -LiteralPath $build.installer -Destination $target -Force

Write-Host ''
Write-Host "Installer: $target"
Write-Host "SHA-256:   $((Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash)"
Write-Host "Commit:    $($build.commit)"
