<#
  Modo desarrollo: una sola vez y todo se actualiza solo.
    .\dev.ps1            -> servidor con recarga automatica + cliente en modo dev
    .\dev.ps1 -NoClient  -> solo el servidor con recarga automatica
  - Servidor (apps/api): al guardar un .py se reinicia solo.
  - Cliente (React): los cambios se ven al instante (hot reload), sin recompilar.
  - Cliente (Rust): se recompila y reabre solo al guardar.
  - Launcher (Python): usa apps/launcher directo; cada descarga nueva ya toma el codigo nuevo.
  Para cerrar todo: Ctrl+C en esta ventana.
  Cuando quieras el .exe final de siempre, sigue existiendo .\build-and-run.ps1 -Server
#>
[CmdletBinding()]
param(
    [switch]$NoClient,
    [ValidateRange(1024, 65535)][int]$ServerPort = 38147
)
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$apiRoot = Join-Path $root 'apps\api'
$desktopRoot = Join-Path $root 'apps\desktop'
$python = Join-Path $apiRoot '.venv\Scripts\python.exe'
$requirements = Join-Path $apiRoot 'requirements.txt'
$stamp = Join-Path $apiRoot '.venv\.gameaccess-requirements.sha256'
$log = Join-Path $apiRoot "local-api-$ServerPort.log"
$apiUrl = "http://127.0.0.1:$ServerPort"

if (-not (Test-Path -LiteralPath $python)) { throw "Falta el entorno del servidor ($python). Corre una vez .\build-and-run.ps1 -Server para crearlo." }

# Dependencias del servidor: solo si cambiaron
$hash = (Get-FileHash -LiteralPath $requirements -Algorithm SHA256).Hash
$installed = if (Test-Path -LiteralPath $stamp) { (Get-Content -LiteralPath $stamp -Raw).Trim() } else { '' }
if ($installed -ne $hash) {
    Write-Host 'Instalando dependencias del servidor...'
    & $python -m pip install --disable-pip-version-check -r $requirements
    if ($LASTEXITCODE -ne 0) { throw 'No se pudieron instalar las dependencias del servidor.' }
    Set-Content -LiteralPath $stamp -Value $hash -Encoding ASCII
}

Push-Location $apiRoot
try {
    & $python -m app.database --verify-shared
    if ($LASTEXITCODE -ne 0) { throw 'La base compartida no esta configurada o no responde.' }
} finally { Pop-Location }

# Liberar el puerto si quedo un servidor viejo
foreach ($listener in @(Get-NetTCPConnection -LocalPort $ServerPort -State Listen -ErrorAction SilentlyContinue)) {
    try { Stop-Process -Id $listener.OwningProcess -Force -ErrorAction Stop } catch {}
}
Start-Sleep -Milliseconds 700

if (Test-Path -LiteralPath $log) { Remove-Item -LiteralPath $log -Force -ErrorAction SilentlyContinue }
$cmd = "cd /d `"$apiRoot`" && `"$python`" -m uvicorn app.main:app --host 127.0.0.1 --port $ServerPort --reload --reload-dir app > `"$log`" 2>&1"
$server = Start-Process -FilePath 'cmd.exe' -ArgumentList '/d', '/s', '/c', $cmd -WindowStyle Hidden -PassThru

try {
    $ready = $false
    for ($i = 0; $i -lt 60; $i++) {
        Start-Sleep -Milliseconds 500
        try { if ((Invoke-RestMethod "$apiUrl/health" -TimeoutSec 2).ok) { $ready = $true; break } } catch {}
    }
    if (-not $ready) { throw "El servidor no arranco. Mira $log" }
    Write-Host "Servidor listo en $apiUrl (se reinicia solo al guardar). Panel: $apiUrl/admin/dashboard"
    Write-Host "Log del servidor: $log"

    if ($NoClient) {
        Write-Host 'Solo servidor. Ctrl+C para cerrar.'
        while ($true) { Start-Sleep -Seconds 5 }
    } else {
        $env:VITE_GAMEACCESS_API = $apiUrl
        $env:GAMEACCESS_ALLOW_LOCAL_ACTIVATION = '1'
        $env:GAMEACCESS_LAUNCHER_DIR = Join-Path $root 'apps\launcher'
        $env:CARGO_TARGET_DIR = Join-Path $desktopRoot 'src-tauri\target-dev'
        Write-Host 'Abriendo el cliente en modo dev (la primera vez compila Rust y tarda unos minutos; despues es rapido)...'
        Push-Location $desktopRoot
        try { & npm.cmd run tauri -- dev } finally { Pop-Location }
    }
} finally {
    Write-Host 'Cerrando el servidor...'
    if ($server) { & taskkill.exe /T /F /PID $server.Id 2>$null | Out-Null }
    foreach ($listener in @(Get-NetTCPConnection -LocalPort $ServerPort -State Listen -ErrorAction SilentlyContinue)) {
        try { Stop-Process -Id $listener.OwningProcess -Force -ErrorAction Stop } catch {}
    }
}
