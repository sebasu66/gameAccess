[CmdletBinding()]
param(
    # The download sources plugin's package: the zip it publishes for "install plugin" links, which mirrors
    # %APPDATA%\GameAccess\plugins. A local path or an https URL. Without it: GAMEACCESS_TESTER_PLUGIN, then
    # "pluginPackage" in build-tester-package.local.json next to this script (not versioned).
    [string]$PluginPackage = $env:GAMEACCESS_TESTER_PLUGIN,
    # The package's SHA-256. Optional: for a URL, "<package URL>.sha256" next to it is tried; the package is not
    # used if it does not match.
    [string]$PluginSha256 = '',
    # A Game Access installer to wrap instead of building one here (for example the signed release installer from
    # GitHub, whose installs update themselves; a local build is the dev channel and does not).
    [string]$AppInstaller = '',
    # Added to the package's name, so a special build is not taken for a normal one (build-test-installer.ps1 uses
    # "prueba-local": that app accepts activations from the local server).
    [string]$Label = ''
)

# Builds a package for testers: Game Access and the download sources plugin in one installer,
# GameAccess-<version>+download-plugin-<plugin version>.exe in this folder. Nothing changes in the app or its own
# installer: this package first copies the plugin into the user's plugins folder (as the app's "install plugin" link
# does: the user's own top-level .json settings are kept, a running plugin is stopped first), then runs the normal
# Game Access installer, built here from this checkout (Steam import included). Uninstalling Game Access removes the
# plugin as usual. The plugin is a choice (Seba, 2026-10-31): a ticked box on the package's first page, in Windows'
# language (Spanish or English); Game Access itself is always installed.
#   .\build-tester-package.ps1
$ErrorActionPreference = 'Stop'
$projectRoot = $PSScriptRoot
$makensis = Join-Path $env:LOCALAPPDATA 'tauri\NSIS\Bin\makensis.exe'
if (-not (Test-Path -LiteralPath $makensis)) { throw "NSIS not found at $makensis (it comes with the Tauri build tools: run build-installer.ps1 once)." }
$localSettings = Join-Path $projectRoot 'build-tester-package.local.json'
if (-not $PluginPackage -and (Test-Path -LiteralPath $localSettings)) {
    $PluginPackage = (Get-Content -LiteralPath $localSettings -Raw | ConvertFrom-Json).pluginPackage
}
if (-not $PluginPackage) { throw "Say which plugin package to include: `"pluginPackage`" in $localSettings (zip path or https URL), GAMEACCESS_TESTER_PLUGIN or -PluginPackage." }

$version = (Get-Content (Join-Path $projectRoot 'apps\desktop\src-tauri\tauri.conf.json') -Raw | ConvertFrom-Json).version
$staging = Join-Path ([System.IO.Path]::GetTempPath()) ('gameaccess-tester-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $staging | Out-Null

try {
    # 1. The Game Access installer.
    if (-not $AppInstaller) {
        & (Join-Path $projectRoot 'build-installer.ps1')
        if ($LASTEXITCODE -and $LASTEXITCODE -ne 0) { throw "build-installer.ps1 failed (exit $LASTEXITCODE)." }
        $AppInstaller = Join-Path $projectRoot "GameAccess-Setup-$version.exe"
        $steamImport = Join-Path $projectRoot 'apps\desktop\src-tauri\target\release\runtime\launcher\steam_account_manager\manager.py'
        if (-not (Test-Path -LiteralPath $steamImport)) { throw "The built app has no Steam import ($steamImport is missing)." }
    }
    $AppInstaller = (Resolve-Path -LiteralPath $AppInstaller).Path

    # 2. The plugin package, checked against its SHA-256 when one is known.
    $zip = Join-Path $staging 'plugin.zip'
    $pluginVersion = ''
    if ($PluginPackage -match '^https://') {
        $ProgressPreference = 'SilentlyContinue'
        # A release asset behind /releases/latest/download/ first redirects to .../download/v<version>/...
        $probe = [System.Net.HttpWebRequest]::Create($PluginPackage)
        $probe.Method = 'HEAD'
        $probe.AllowAutoRedirect = $false
        try { $answer = $probe.GetResponse(); $location = $answer.Headers['Location']; $answer.Close() } catch { $location = $null }
        if ("$location $PluginPackage" -match '/download/v?([0-9][^/]*)/') { $pluginVersion = $Matches[1] }
        Invoke-WebRequest -Uri $PluginPackage -OutFile $zip -UseBasicParsing
        if (-not $PluginSha256) {
            foreach ($shaUrl in @("$PluginPackage.sha256", ($PluginPackage -replace '\.zip$', '.sha256'))) {
                try {
                    $content = (Invoke-WebRequest -Uri $shaUrl -UseBasicParsing).Content
                    if ($content -is [byte[]]) { $content = [System.Text.Encoding]::ASCII.GetString($content) }
                    $PluginSha256 = ($content.Trim() -split '\s+')[0]
                    break
                } catch { }
            }
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
    $name = if ($Label) { "GameAccess-$version-$Label" } else { "GameAccess-$version" }
    $output = if ($pluginVersion) { Join-Path $projectRoot "$name+download-plugin-$pluginVersion.exe" } else { Join-Path $projectRoot "$name+download-plugin.exe" }

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
VIProductVersion "$version.0"
VIAddVersionKey "ProductName" "Game Access + download plugin"
VIAddVersionKey "ProductVersion" "$version$(if ($pluginVersion) { "+download-plugin-$pluginVersion" })"
VIAddVersionKey "FileVersion" "$version"
VIAddVersionKey "FileDescription" "Game Access $version + download plugin$(if ($pluginVersion) { " $pluginVersion" })"
; The user's own plugins folder (%APPDATA%): this part runs without elevation; the Game Access installer asks for it.
RequestExecutionLevel user
SetCompressor /SOLID lzma
ShowInstDetails show
; Windows' language picks the texts (Spanish, else English).
LoadLanguageFile "`${NSISDIR}\Contrib\Language files\English.nlf"
LoadLanguageFile "`${NSISDIR}\Contrib\Language files\Spanish.nlf"
LangString GaChoose `${LANG_ENGLISH} "Game Access is always installed. Untick the download sources plugin to leave it out."
LangString GaChoose `${LANG_SPANISH} "Game Access se instala siempre. Destildá el plugin de fuentes de descarga para no instalarlo."
LangString GaApp `${LANG_ENGLISH} "Game Access"
LangString GaApp `${LANG_SPANISH} "Game Access"
LangString GaPlugin `${LANG_ENGLISH} "Download sources plugin"
LangString GaPlugin `${LANG_SPANISH} "Plugin de fuentes de descarga"
ComponentText "`$(GaChoose)"
Page components
Page instfiles

; Ticked by default; unticked, nothing of the plugin is copied.
Section "`$(GaPlugin)" SecPlugin
  nsExec::Exec ``powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "Get-Process | Where-Object { `$`$_.Path -like '*\GameAccess\plugins\*' } | Stop-Process -Force"``
  Pop `$0
  SetOutPath "`$APPDATA\GameAccess\plugins"
  SetOverwrite on
$($fileLines -join "`r`n")
SectionEnd

; Always: the normal Game Access installer (it asks for elevation itself).
Section "`$(GaApp)" SecApp
  SectionIn RO
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
    Write-Host "Plugin:         $PluginPackage$(if ($pluginVersion) { " v$pluginVersion" }) ($pluginCheck)"
} finally {
    Remove-Item -LiteralPath $staging -Recurse -Force -ErrorAction SilentlyContinue
}
