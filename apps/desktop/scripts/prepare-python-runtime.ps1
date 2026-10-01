$ErrorActionPreference = "Stop"

$pythonVersion = "3.12.9"
$pythonArchive = "python-$pythonVersion-embed-amd64.zip"
$pythonUrl = "https://www.python.org/ftp/python/$pythonVersion/$pythonArchive"
$pythonMd5 = "f34996cc1f44c98729ef6ce92d05e41c"

$desktopRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$repoRoot = Resolve-Path (Join-Path $desktopRoot "..\..")
$launcherSource = Join-Path $repoRoot "apps\launcher"
$runtimeRoot = Join-Path $desktopRoot "src-tauri\runtime"
$launcherTarget = Join-Path $runtimeRoot "launcher"
$pythonTarget = Join-Path $runtimeRoot "python"
$requirements = Join-Path $launcherSource "requirements.txt"
$marker = Join-Path $pythonTarget "gameaccess-runtime.json"

if (-not (Test-Path $requirements)) {
    throw "Launcher requirements not found: $requirements"
}

# Stage only runtime source files. Never copy the local .venv, .gameaccess
# state, caches, credentials, or other developer-machine data.
Remove-Item $launcherTarget -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $launcherTarget -Force | Out-Null
Get-ChildItem $launcherSource -File |
    Where-Object { $_.Extension -eq ".py" -or $_.Name -eq "requirements.txt" } |
    Copy-Item -Destination $launcherTarget

$requirementsSha = (Get-FileHash $requirements -Algorithm SHA256).Hash
$runtimeReady = $false
if (Test-Path $marker) {
    try {
        $state = Get-Content $marker -Raw | ConvertFrom-Json
        $runtimeReady =
            $state.python_version -eq $pythonVersion -and
            $state.requirements_sha256 -eq $requirementsSha -and
            (Test-Path (Join-Path $pythonTarget "python.exe"))
    } catch {
        $runtimeReady = $false
    }
}

if ($runtimeReady) {
    Get-ChildItem $runtimeRoot -Directory -Recurse -Filter "__pycache__" -ErrorAction SilentlyContinue |
        Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
    Write-Host "Embedded Python runtime is up to date."
    exit 0
}

$builderPython = $null
$builderCandidates = @()

$pyLauncher = Get-Command py.exe -ErrorAction SilentlyContinue
if ($pyLauncher) {
    try {
        $pyResolved = & $pyLauncher.Source -3 -c "import sys; print(sys.executable)" 2>$null
        if ($LASTEXITCODE -eq 0 -and $pyResolved) {
            $builderCandidates += $pyResolved.Trim()
        }
    } catch {}
}

Get-Command python.exe -All -ErrorAction SilentlyContinue |
    ForEach-Object { $builderCandidates += $_.Source }

foreach ($candidate in ($builderCandidates | Select-Object -Unique)) {
    try {
        & $candidate -m pip --version *> $null
        if ($LASTEXITCODE -eq 0) {
            $builderPython = $candidate
            break
        }
    } catch {}
}

if (-not $builderPython) {
    throw "Building the Windows bundle requires any Python installation with pip."
}

Remove-Item $pythonTarget -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $pythonTarget -Force | Out-Null

$tempArchive = Join-Path ([System.IO.Path]::GetTempPath()) $pythonArchive
Invoke-WebRequest -Uri $pythonUrl -OutFile $tempArchive
$actualMd5 = (Get-FileHash $tempArchive -Algorithm MD5).Hash.ToLowerInvariant()
if ($actualMd5 -ne $pythonMd5) {
    Remove-Item $tempArchive -Force -ErrorAction SilentlyContinue
    throw "Embedded Python archive checksum mismatch."
}

Expand-Archive -Path $tempArchive -DestinationPath $pythonTarget -Force
Remove-Item $tempArchive -Force -ErrorAction SilentlyContinue

$sitePackages = Join-Path $pythonTarget "Lib\site-packages"
New-Item -ItemType Directory -Path $sitePackages -Force | Out-Null
& $builderPython -m pip install --disable-pip-version-check --no-compile --only-binary=:all: --platform win_amd64 --python-version 3.12 --implementation cp --abi cp312 --target $sitePackages -r $requirements
if ($LASTEXITCODE -ne 0) {
    throw "Failed to install embedded launcher dependencies."
}

$pth = Join-Path $pythonTarget "python312._pth"
@(
    "python312.zip"
    "."
    "Lib\site-packages"
    "..\launcher"
    "import site"
) | Set-Content -Path $pth -Encoding ASCII

Get-ChildItem $runtimeRoot -Directory -Recurse -Filter "__pycache__" -ErrorAction SilentlyContinue |
    Remove-Item -Recurse -Force -ErrorAction SilentlyContinue

@{
    python_version = $pythonVersion
    requirements_sha256 = $requirementsSha
} | ConvertTo-Json | Set-Content -Path $marker -Encoding UTF8

& (Join-Path $pythonTarget "python.exe") -B -c "import requests, pywinauto, selenium; import steam_pool, provider_download_manager; print('embedded-runtime-ok')"
if ($LASTEXITCODE -ne 0) {
    throw "Embedded Python runtime self-test failed."
}

Get-ChildItem $runtimeRoot -Directory -Recurse -Filter "__pycache__" -ErrorAction SilentlyContinue |
    Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
