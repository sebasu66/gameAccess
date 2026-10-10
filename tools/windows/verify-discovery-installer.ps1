[CmdletBinding()]
param([string]$Installer)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
if (-not $Installer) {
    $build = Get-Content (Join-Path $root 'GameAccess-discovery-installer.build.json') -Raw | ConvertFrom-Json
    $Installer = $build.installer
    if ((git -C $root rev-parse HEAD).Trim() -ne $build.commit) { throw 'Installer was built from a different commit.' }
    if ((Get-FileHash -LiteralPath $Installer -Algorithm SHA256).Hash -ne $build.sha256) { throw 'Installer hash mismatch.' }
}
$destination = [IO.Path]::GetFullPath((Join-Path $root ('.cache/installer-check-' + [Guid]::NewGuid().ToString('N'))))
$workspaceRoot = [IO.Path]::GetFullPath($root).TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
if (-not $destination.StartsWith($workspaceRoot, [StringComparison]::OrdinalIgnoreCase)) { throw 'Extraction directory is outside workspace.' }
$sevenZip = 'C:/Program Files/7-Zip/7z.exe'
if (-not (Test-Path -LiteralPath $sevenZip)) { throw '7-Zip is required for payload verification.' }
& $sevenZip x $Installer "-o$destination" -y | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Installer extraction failed.' }
$manifestFile = Get-ChildItem -LiteralPath $destination -Recurse -File -Filter 'catalog-manifest.json' | Select-Object -First 1
if (-not $manifestFile) { throw 'Catalog manifest is missing from installer.' }
$manifest = Get-Content -LiteralPath $manifestFile.FullName -Raw | ConvertFrom-Json
$package = Join-Path $manifestFile.DirectoryName ("catalog-cache-" + $manifest.revision + ".sqlite.gz")
if ((Get-FileHash -LiteralPath $package -Algorithm SHA256).Hash.ToLowerInvariant() -ne $manifest.sha256) { throw 'Bundled catalog hash mismatch.' }
if (-not $manifest.coverage.recent_complete -or $manifest.catalog_count -lt 25000) { throw 'Catalog coverage is incomplete.' }
$modules = Get-ChildItem -LiteralPath $destination -Recurse -File -Filter '*.py'
foreach ($forbidden in @('provider_download.py','provider_login.py','steam_pool.py','steam_switch.py','launcher.py')) {
    if ($modules.Name -contains $forbidden) { throw "Legacy account module bundled: $forbidden" }
}
foreach ($required in @('digital_downloader.py','digital_process_runner.py','digital_library.py')) {
    if ($modules.Name -notcontains $required) { throw "Missing game runtime module: $required" }
}
@{ installer=$Installer; catalog_count=$manifest.catalog_count; revision=$manifest.revision; payload_verified=$true; extracted_to=$destination } | ConvertTo-Json
