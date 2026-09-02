$ErrorActionPreference = 'Stop'

$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$AddonsDir = Join-Path $ProjectRoot 'addons'
$TempDir = Join-Path $env:TEMP 'gameaccess-xr-setup'

$packages = @(
    @{
        Name = 'Godot XR Tools'
        Version = '4.5.1'
        Url = 'https://github.com/GodotVR/godot-xr-tools/releases/download/4.5.1/godot-xr-tools.zip'
        Sha256 = 'f60d15e6b1bc4e544947691cb8de73c483dfe9e9a4c4dad92511e0d8f575dcae'
    },
    @{
        Name = 'Godot OpenXR Vendors'
        Version = '5.1.0-stable'
        Url = 'https://github.com/GodotVR/godot_openxr_vendors/releases/download/5.1.0-stable/godotopenxrvendorsaddon.zip'
        Sha256 = '6a838dbdf4115549e4511ebee0da9a5dcc8f9f6258d4cc2f2ee57a907a3e2911'
    },
    @{
        Name = 'Godot Meta Toolkit'
        Version = '1.0.3-stable'
        Url = 'https://github.com/godot-sdk-integrations/godot-meta-toolkit/releases/download/1.0.3-stable/godotmetatoolkitaddon.zip'
        Sha256 = 'cbd23eb9c0ce6868570aa43a674688d749bafeab6b38027f5a588bb21b27d879'
    }
)

function Install-AddonPackage {
    param([hashtable]$Package)

    $safeName = ($Package.Name -replace '[^A-Za-z0-9_-]', '_')
    $zipPath = Join-Path $TempDir "$safeName.zip"
    $extractDir = Join-Path $TempDir $safeName

    Write-Host "Downloading $($Package.Name) $($Package.Version)..."
    Invoke-WebRequest -Uri $Package.Url -OutFile $zipPath -UseBasicParsing

    $actualHash = (Get-FileHash -Path $zipPath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actualHash -ne $Package.Sha256.ToLowerInvariant()) {
        throw "Checksum mismatch for $($Package.Name). Expected $($Package.Sha256), got $actualHash"
    }

    if (Test-Path $extractDir) { Remove-Item $extractDir -Recurse -Force }
    Expand-Archive -Path $zipPath -DestinationPath $extractDir -Force

    $addonRoots = Get-ChildItem -Path $extractDir -Directory -Recurse | Where-Object { $_.Name -eq 'addons' }
    if (-not $addonRoots) {
        throw "Could not locate an addons directory inside $($Package.Name) archive."
    }

    foreach ($addonRoot in $addonRoots) {
        Get-ChildItem -Path $addonRoot.FullName -Directory | ForEach-Object {
            $destination = Join-Path $AddonsDir $_.Name
            if (Test-Path $destination) { Remove-Item $destination -Recurse -Force }
            Copy-Item -Path $_.FullName -Destination $destination -Recurse -Force
            Write-Host "Installed addon: $($_.Name)"
        }
    }
}

Write-Host 'Game Access XR setup'
Write-Host 'Target: Godot 4.7.1+ / Meta Quest 3 / OpenXR'

if (Test-Path $TempDir) { Remove-Item $TempDir -Recurse -Force }
New-Item -ItemType Directory -Path $TempDir -Force | Out-Null
New-Item -ItemType Directory -Path $AddonsDir -Force | Out-Null

try {
    foreach ($package in $packages) {
        Install-AddonPackage -Package $package
    }

    Write-Host ''
    Write-Host 'XR dependencies installed successfully.'
    Write-Host "Open this Godot project: $ProjectRoot"
    Write-Host 'For Quest standalone export, install Godot Android build templates and configure Android SDK/JDK as usual.'
}
finally {
    if (Test-Path $TempDir) { Remove-Item $TempDir -Recurse -Force }
}
