[CmdletBinding()]
param(
    # The download sources plugin's package: the zip it publishes for "install plugin" links, which mirrors
    # %APPDATA%\GameAccess\plugins. A local path or an https URL; also read from GAMEACCESS_TESTER_PLUGIN.
    [string]$PluginPackage = $env:GAMEACCESS_TESTER_PLUGIN,
    # The package's SHA-256. Optional: for a URL, "<package URL>.sha256" next to it is tried; the package is not
    # used if it does not match.
    [string]$PluginSha256 = '',
    # A Game Access installer to wrap instead of building one here (for example the signed release installer from
    # GitHub, whose installs update themselves; a local build is the dev channel and does not).
    [string]$AppInstaller = ''
)

# Builds a package for testers: Game Access and the download sources plugin in one installer,
# GameAccess-<version>+download-plugin.exe in this folder. Nothing changes in the app or its own installer:
# this package first copies the plugin into the user's plugins folder (as the app's "install plugin" link does:
# the user's own top-level .json settings are kept, a running plugin is stopped first), then runs the normal Game
# Access installer. Uninstalling Game Access removes the plugin as usual.
#   .\build-tester-package.ps1 -PluginPackage <zip path or URL> [-AppInstaller <GameAccess setup .exe>]
$ErrorActionPreference = 'Stop'
$projectRoot = $PSScriptRoot
$makensis = Join-Path $env:LOCALAPPDATA 'tauri\NSIS\Bin\makensis.exe'
if (-not (Test-Path -LiteralPath $makensis)) { throw "NSIS not found at $makensis (it comes with the Tauri build tools: run build-installer.ps1 once)." }
if (-not $PluginPackage) { throw 'Say which plugin package to include: -PluginPackage <zip path or https URL> (or set GAMEACCESS_TESTER_PLUGIN).' }

$version = (Get-Content (Join-Path $projectRoot 'apps\desktop\src-tauri\tauri.conf.json') -Raw | ConvertFrom-Json).version
$output = Join-Path $projectRoot "GameAccess-$version+download-plugin.exe"
$staging = Join-Path ([System.IO.Path]::GetTempPath()) ('gameaccess-tester-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $staging | Out-Null

try {
    # 1. The Game Access installer.
    if (-not $AppInstaller) {
        & (Join-Path $projectRoot 'build-installer.ps1')
        if ($LASTEXITCODE -and $LASTEXITCODE -ne 0) { throw "build-installer.ps1 failed (exit $LASTEXITCODE)." }
        $AppInstaller = Join-Path $projectRoot "GameAccess-Setup-$version.exe"
    }
    $AppInstaller = (Resolve-Path -LiteralPath $AppInstaller).Path

    # 2. The plugin package, checked against its SHA-256 when one is known.
    $zip = Join-Path $staging 'plugin.zip'
    if ($PluginPackage -match '^https://') {
        Invoke-WebRequest -Uri $PluginPackage -OutFile $zip -UseBasicParsing
        if (-not $PluginSha256) {
            try { $PluginSha256 = ((Invoke-WebRequest -Uri "$PluginPackage.sha256" -UseBasicParsing).Content -split '\s+')[0] } catch { }
        }
    } else {
        Copy-Item -LiteralPath (Resolve-Path -LiteralPath $PluginPackage).Path -Destination $zip
        $sidecar = [System.IO.Path]::ChangeExtension($PluginPackage, '.sha256')
        if (-not $PluginSha256 -and (Test-Path -LiteralPath $sidecar)) { $PluginSha256 = ((Get-Content -LiteralPath $sidecar -Raw) -split '\s+')[0] }
    }
    $actual = (Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash
    if ($PluginSha256) {
        if ($actual -ne $PluginSha256.Trim().ToUpperInvariant()) { throw "The plugin package does not match its SHA-256 ($actual vs $PluginSha256)." }
        $pluginCheck = 'SHA-256 verified'
    } else { $pluginCheck = 'no SHA-256 to verify against' }
    $plugins = Join-Path $staging 'plugins'
    Expand-Archive -LiteralPath $zip -DestinationPath $plugins
    $folders = @(Get-ChildItem -LiteralPath $plugins -Directory)
    if (-not $folders) { throw 'The plugin package has no plugin folder: it is not a plugins-folder package.' }

    # 3. The NSIS script: plugin folders replaced, top-level settings kept (as plugin_install.rs does), then the app.
    $q = { param($path) $path.Replace('"', '$\"') }
    $fileLines = @()
    foreach ($folder in $folders) { $fileLines += "  File /r `"$(& $q $folder.FullName)`"" }
    $topFiles = @(Get-ChildItem -LiteralPath $plugins -File)
    $settings = @($topFiles | Where-Object { $_.Extension -eq '.json' })
    $others = @($topFiles | Where-Object { $_.Extension -ne '.json' })
    foreach ($file in $others) { $fileLines += "  File `"$(& $q $file.FullName)`"" }
    if ($settings) {
        $fileLines += '  SetOverwrite off'
        foreach ($file in $settings) { $fileLines += "  File `"$(& $q $file.FullName)`"" }
        $fileLines += '  SetOverwrite on'
    }
    $icon = Join-Path $projectRoot 'apps\desktop\src-tauri\icons\icon.ico'
    $nsi = @"
Unicode true
Name "Game Access $version + download plugin"
OutFile "$(& $q $output)"
Icon "$(& $q $icon)"
; The user's own plugins folder (%APPDATA%): this part runs without elevation; the Game Access installer asks for it.
RequestExecutionLevel user
SetCompressor /SOLID lzma
ShowInstDetails show
Page instfiles

Section
  nsExec::Exec ``powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "Get-Process | Where-Object { `$`$_.Path -like '*\GameAccess\plugins\*' } | Stop-Process -Force"``
  Pop `$0
  SetOutPath "`$APPDATA\GameAccess\plugins"
  SetOverwrite on
$($fileLines -join "`r`n")
  InitPluginsDir
  SetOutPath "`$PLUGINSDIR"
  File "/oname=`$PLUGINSDIR\GameAccess-Setup.exe" "$(& $q $AppInstaller)"
  ExecShellWait "open" "`$PLUGINSDIR\GameAccess-Setup.exe"
SectionEnd
"@
    $nsiPath = Join-Path $staging 'tester-package.nsi'
    Set-Content -LiteralPath $nsiPath -Value $nsi -Encoding UTF8
    & $makensis /V2 $nsiPath
    if ($LASTEXITCODE -ne 0) { throw "makensis failed (exit $LASTEXITCODE)." }

    Write-Host ''
    Write-Host "Tester package: $output"
    Write-Host "SHA-256:        $((Get-FileHash -LiteralPath $output -Algorithm SHA256).Hash)"
    Write-Host "Game Access:    $AppInstaller"
    Write-Host "Plugin:         $PluginPackage ($pluginCheck)"
} finally {
    Remove-Item -LiteralPath $staging -Recurse -Force -ErrorAction SilentlyContinue
}
