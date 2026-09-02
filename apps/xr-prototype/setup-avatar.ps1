param(
    [switch]$IncludeExamples
)

$ErrorActionPreference = 'Stop'

$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$AddonsDir = Join-Path $ProjectRoot 'addons'
$TempDir = Join-Path $env:TEMP 'gameaccess-avatar-setup'

$ConfiguraCommit = '0a7b08b74a5a7e684d3242cf3f1140cffed023cb'
$ConfiguraUrl = "https://github.com/Team-Figoose/Configura/archive/$ConfiguraCommit.zip"
$ZipPath = Join-Path $TempDir 'configura.zip'
$ExtractDir = Join-Path $TempDir 'configura'
$Destination = Join-Path $AddonsDir 'Configura'

Write-Host 'Game Access avatar setup'
Write-Host 'Target: Godot 4.7.1+'
Write-Host "Configura commit: $ConfiguraCommit"

if (Test-Path $TempDir) { Remove-Item $TempDir -Recurse -Force }
New-Item -ItemType Directory -Path $TempDir -Force | Out-Null
New-Item -ItemType Directory -Path $AddonsDir -Force | Out-Null

try {
    Write-Host 'Downloading Configura...'
    Invoke-WebRequest -Uri $ConfiguraUrl -OutFile $ZipPath -UseBasicParsing
    Expand-Archive -Path $ZipPath -DestinationPath $ExtractDir -Force

    $source = Get-ChildItem -Path $ExtractDir -Directory |
        ForEach-Object { Join-Path $_.FullName 'addons\Configura' } |
        Where-Object { Test-Path (Join-Path $_ 'plugin.cfg') } |
        Select-Object -First 1

    if (-not $source) {
        throw 'Could not locate addons/Configura/plugin.cfg in the pinned Configura archive.'
    }

    if (Test-Path $Destination) { Remove-Item $Destination -Recurse -Force }
    Copy-Item -Path $source -Destination $Destination -Recurse -Force

    if (-not $IncludeExamples) {
        $examples = Join-Path $Destination '!example'
        if (Test-Path $examples) {
            Remove-Item $examples -Recurse -Force
        }
    }

    if (-not (Test-Path (Join-Path $Destination 'plugin.cfg'))) {
        throw 'Configura installation validation failed: plugin.cfg is missing.'
    }

    Write-Host ''
    Write-Host 'Configura installed successfully.'
    Write-Host "Installed to: $Destination"
    if ($IncludeExamples) {
        Write-Host 'Example assets were included for local evaluation.'
    } else {
        Write-Host 'Example assets were omitted to keep the prototype lightweight.'
        Write-Host 'Use -IncludeExamples if you want Configura sample/Mii assets locally.'
    }
    Write-Host 'Open the project in Godot and enable Configura under Project Settings > Plugins if needed.'
}
finally {
    if (Test-Path $TempDir) { Remove-Item $TempDir -Recurse -Force }
}
