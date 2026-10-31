[CmdletBinding()]
param(
    # The download sources plugin's package, as build-tester-package.ps1 takes it (zip path or https URL); without it,
    # GAMEACCESS_TESTER_PLUGIN or "pluginPackage" in build-tester-package.local.json. Only its page is used: the box
    # opens it (or "pluginPage" in that file).
    [string]$PluginPackage = '',
    [string]$PluginSha256 = '',
    # A Game Access installer already built with local activation, to wrap instead of building one again.
    [string]$AppInstaller = '',
    # The sample users from zero (their PLUS keys change).
    [switch]$ResetUsers,
    # Only build; the local server is not started.
    [switch]$NoServer
)

# Builds the test installer for this PC: Game Access accepting activations from the local server
# (GAMEACCESS_ALLOW_LOCAL_ACTIVATION=1), wrapped with a ticked box that opens the download sources plugin's page
# (build-tester-package.ps1 -PluginLink), as GameAccess-<version>-prueba-local+download-plugin-link.exe in this folder.
# Then it starts the local server with sample users (apps/api/run_demo_users_api.ps1: its own SQLite, never the
# customers' database, on port 38147, the one the app tries first), which prints a PLUS key for each state.
# Only for this PC: never hand this installer out.
#   .\build-test-installer.ps1               (-ResetUsers: sample users from zero; -NoServer: build only)
$ErrorActionPreference = 'Stop'
$previous = $env:GAMEACCESS_ALLOW_LOCAL_ACTIVATION
try {
    $env:GAMEACCESS_ALLOW_LOCAL_ACTIVATION = '1'
    # The plugin's box only opens its page (Seba, 2026-10-31): nothing of the plugin is inside this package.
    $package = @{ Label = 'prueba-local'; PluginLink = $true }
    if ($PluginPackage) { $package.PluginPackage = $PluginPackage }
    if ($PluginSha256) { $package.PluginSha256 = $PluginSha256 }
    if ($AppInstaller) { $package.AppInstaller = $AppInstaller }
    & (Join-Path $PSScriptRoot 'build-tester-package.ps1') @package
} finally {
    $env:GAMEACCESS_ALLOW_LOCAL_ACTIVATION = $previous
}

if (-not $NoServer) {
    Write-Host ''
    Write-Host 'Starting the local server with sample users (port 38147)...'
    $server = @{}
    if ($ResetUsers) { $server.Reset = $true }
    & (Join-Path $PSScriptRoot 'apps\api\run_demo_users_api.ps1') @server
}
