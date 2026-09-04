[CmdletBinding()]
param(
    [switch]$Force,
    [string]$ProjectRoot = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($ProjectRoot)) {
    $ProjectRoot = Split-Path -Parent $PSScriptRoot
}

$Version = 'v1.15.3'
$ArchiveName = 'godot_cef-v1.15.3.zip'
$ArchiveSha256 = '37420fb0929987faf3d349194c68a9ba13a60fbf4075a5c5e4d5cf20ddcf1c8f'
$DownloadUrl = "https://github.com/dsh0416/godot-cef/releases/download/$Version/$ArchiveName"
$AddonDirectory = Join-Path $ProjectRoot 'addons\godot_cef'
$VersionMarker = Join-Path $AddonDirectory '.gameaccess-version'

function Test-InstalledVersion {
    if (-not (Test-Path -LiteralPath $VersionMarker -PathType Leaf)) {
        return $false
    }
    return ((Get-Content -LiteralPath $VersionMarker -Raw).Trim() -eq $Version)
}

if ((-not $Force) -and (Test-InstalledVersion)) {
    Write-Host "Godot CEF $Version is already installed at $AddonDirectory"
    exit 0
}

$tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("gameaccess-godot-cef-" + [Guid]::NewGuid().ToString('N'))
$archivePath = Join-Path $tempRoot $ArchiveName
$extractPath = Join-Path $tempRoot 'extracted'

try {
    New-Item -ItemType Directory -Force -Path $tempRoot, $extractPath | Out-Null
    Write-Host "Downloading Godot CEF $Version..."
    Invoke-WebRequest -Uri $DownloadUrl -OutFile $archivePath -UseBasicParsing

    $actualHash = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actualHash -ne $ArchiveSha256) {
        throw "Checksum mismatch for $ArchiveName. Expected $ArchiveSha256, got $actualHash."
    }

    Write-Host 'Checksum verified. Extracting...'
    Expand-Archive -LiteralPath $archivePath -DestinationPath $extractPath -Force

    $addonSource = Get-ChildItem -LiteralPath $extractPath -Directory -Recurse |
        Where-Object { $_.Name -eq 'godot_cef' -and (Test-Path -LiteralPath (Join-Path $_.FullName 'godot_cef.gdextension')) } |
        Select-Object -First 1

    if ($null -eq $addonSource) {
        throw 'The release archive does not contain addons/godot_cef/godot_cef.gdextension.'
    }

    if (Test-Path -LiteralPath $AddonDirectory) {
        Remove-Item -LiteralPath $AddonDirectory -Recurse -Force
    }
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $AddonDirectory) | Out-Null
    Copy-Item -LiteralPath $addonSource.FullName -Destination $AddonDirectory -Recurse -Force
    Set-Content -LiteralPath $VersionMarker -Value $Version -Encoding ascii -NoNewline

    Write-Host "Installed Godot CEF $Version at $AddonDirectory"
    Write-Host 'The runtime is intentionally external to Git. Re-run this script on new development machines.'
}
finally {
    if (Test-Path -LiteralPath $tempRoot) {
        Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
}
