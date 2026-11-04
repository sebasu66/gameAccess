<#
  Local server for trying the one-click install (vault/Instalador web.md) on this PC or in Windows Sandbox.

  Serves the API on 0.0.0.0:<Port> with its own SQLite file (never the shared database) and the newest local
  installer (apps/desktop/src-tauri/target/release/bundle/nsis) at /setup/<name>, so the script installs that build.
  The command the page copies points at -PublicHost: 127.0.0.1 for this PC, the vEthernet (Default Switch) address
  for Windows Sandbox (the default when it exists).

  Then open the landing (launch.json "landing") with ?api=http://127.0.0.1:<Port>.
#>
param([int] $Port = 8796, [string] $PublicHost = '')
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$api = Join-Path $root 'apps\api'
$python = Join-Path $api '.venv\Scripts\python.exe'
$nsis = Join-Path $root 'apps\desktop\src-tauri\target\release\bundle\nsis'

$installer = Get-ChildItem $nsis -Filter '*-setup.exe' | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $installer) { throw "No installer in $nsis" }
if (-not $PublicHost) {
  $PublicHost = (Get-NetIPAddress -AddressFamily IPv4 -InterfaceAlias 'vEthernet (Default Switch)' -ErrorAction SilentlyContinue).IPAddress
  if (-not $PublicHost) { $PublicHost = '127.0.0.1' }
}
$data = Join-Path $env:LOCALAPPDATA 'GameAccess-web-install'
New-Item -ItemType Directory -Force $data | Out-Null
$setup = Join-Path $data 'setup'
New-Item -ItemType Directory -Force $setup | Out-Null
Copy-Item $installer.FullName (Join-Path $setup $installer.Name) -Force

$env:GAMEACCESS_DATABASE_URL = "sqlite:///$($data -replace '\\', '/')/api.db"
$env:GAMEACCESS_ALLOW_SQLITE_FOR_TESTS = '1'
$env:GAMEACCESS_PUBLIC_API_URL = "http://${PublicHost}:$Port"
$env:GAMEACCESS_WEB_INSTALL_URL = "http://${PublicHost}:$Port/setup/$($installer.Name)"
$env:GAMEACCESS_WEB_INSTALL_SHA256 = (Get-FileHash $installer.FullName -Algorithm SHA256).Hash.ToLower()
$env:GAMEACCESS_WEB_INSTALL_VERSION = ($installer.Name -replace '^gameAccess_([\d.]+)_.*$', '$1')
$env:GAMEACCESS_WEB_INSTALL_FILES = $setup
Write-Host "API $env:GAMEACCESS_PUBLIC_API_URL  installer $($installer.Name) $env:GAMEACCESS_WEB_INSTALL_SHA256"
Set-Location $api
& $python -m uvicorn app.main:app --host 0.0.0.0 --port $Port
