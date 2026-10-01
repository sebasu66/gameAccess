$ErrorActionPreference = "Stop"

$DesktopRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$RepoRoot = (Resolve-Path (Join-Path $DesktopRoot "..\..")).Path
$SourceRoot = Join-Path $RepoRoot "deploy\catalog-cache"
$ManifestPath = Join-Path $SourceRoot "catalog-manifest.json"
$TargetRoot = Join-Path $DesktopRoot "src-tauri\runtime\catalog"

if (-not (Test-Path $ManifestPath -PathType Leaf)) {
    throw "Catalog manifest not found: $ManifestPath"
}

$manifest = Get-Content $ManifestPath -Raw | ConvertFrom-Json
$artifactName = "catalog-cache-$($manifest.revision).sqlite.gz"
$artifactPath = Join-Path $SourceRoot $artifactName
if (-not (Test-Path $artifactPath -PathType Leaf)) {
    throw "Catalog cache artifact not found: $artifactPath"
}

$actualHash = (Get-FileHash $artifactPath -Algorithm SHA256).Hash.ToLowerInvariant()
$expectedHash = ([string]$manifest.sha256).Trim().ToLowerInvariant()
if ($actualHash -ne $expectedHash) {
    throw "Catalog cache SHA-256 mismatch. Expected $expectedHash, got $actualHash"
}

Remove-Item $TargetRoot -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $TargetRoot -Force | Out-Null
Copy-Item $ManifestPath (Join-Path $TargetRoot "manifest.json") -Force
Copy-Item $artifactPath (Join-Path $TargetRoot "catalog.sqlite.gz") -Force

Write-Host "Prepared bundled catalog seed revision $($manifest.revision) with $($manifest.catalog_count) games."
