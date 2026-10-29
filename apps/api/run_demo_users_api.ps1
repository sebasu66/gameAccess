# Local test server with sample users (US.1): an isolated SQLite file, never the shared customer database.
# Seeds one user per state (scripts/seed_demo_users.py prints their PLUS keys) and starts the API on port 8010.
# The admin console is at http://127.0.0.1:8010/admin (password: the GAMEACCESS_ADMIN_TOKEN below).
# Point the desktop app at it with VITE_GAMEACCESS_API=http://127.0.0.1:8010 to see what a customer sees in each state.
param([int]$Port = 8010, [switch]$Reset)
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
