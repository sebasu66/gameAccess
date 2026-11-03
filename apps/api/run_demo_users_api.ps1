# Local test server with sample users (US.1): an isolated SQLite file, never the shared customer database.
# Seeds one user per state (scripts/seed_demo_users.py prints their PLUS keys) and starts the API on port 38147.
# That is the port the desktop app always tries first (settings.ts DEFAULT_LOCAL_API) and shows as "Local"; a build
# with GAMEACCESS_ALLOW_LOCAL_ACTIVATION=1 accepts activations from it. Any other port is never seen by the app.
# It replaces whatever local API was on that port. The admin console is at http://127.0.0.1:38147 (opens /admin).
param([int]$Port = 38147, [switch]$Reset)
$ErrorActionPreference = 'Stop'
$api = $PSScriptRoot
$python = Join-Path $api '.venv/Scripts/python.exe'
if (-not (Test-Path $python)) { throw "API venv Python not found: $python" }
$db = Join-Path $api 'users-demo.db'
if ($Reset -and (Test-Path $db)) { Remove-Item $db -Force }

$env:PYTHON_DOTENV_DISABLED = '1'
$env:GAMEACCESS_DATABASE_URL = 'sqlite:///' + ($db -replace '\\', '/')
$env:GAMEACCESS_ALLOW_SQLITE_FOR_TESTS = '1'
$env:GAMEACCESS_DISCOVERY_SYNC = '0'
$env:GAMEACCESS_ADMIN_TOKEN = 'demo-users-local-admin-token-000'

& $python (Join-Path $api 'scripts/seed_demo_users.py')
if ($LASTEXITCODE -ne 0) { throw 'Seeding the sample users failed.' }

$listeners = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
foreach ($listener in @($listeners)) { try { Stop-Process -Id $listener.OwningProcess -Force -ErrorAction Stop } catch {} }
Start-Sleep -Milliseconds 500
$log = Join-Path $api "users-demo-$Port.log"
$cmd = "cd /d `"$api`" && `"$python`" -m uvicorn app.main:app --host 127.0.0.1 --port $Port > `"$log`" 2>&1"
Start-Process -FilePath 'cmd.exe' -ArgumentList '/d', '/s', '/c', $cmd -WindowStyle Hidden
for ($i = 0; $i -lt 40; $i++) {
  Start-Sleep -Milliseconds 500
  try { if ((Invoke-RestMethod "http://127.0.0.1:$Port/health" -TimeoutSec 2).ok) { Write-Host "Listo: http://127.0.0.1:$Port/admin"; exit 0 } } catch {}
}
throw "The server did not start; see $log"
