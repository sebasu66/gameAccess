<#
  Prende o apaga el servidor local (apps/api), segun como este:
    - si algo escucha en el puerto, lo detiene (con el proceso que lo lanzo);
    - si no, lo arranca oculto con recarga automatica, igual que dev.ps1.
  Log del servidor: apps\api\local-api-<puerto>.log
#>
[CmdletBinding()]
param(
    [ValidateRange(1024, 65535)][int]$Port = 38147
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$apiRoot = Join-Path $root 'apps\api'
$python = Join-Path $apiRoot '.venv\Scripts\python.exe'
$log = Join-Path $apiRoot "local-api-$Port.log"
$apiUrl = "http://127.0.0.1:$Port"

function Get-ProcessInfo([int]$Id) {
    Get-CimInstance Win32_Process -Filter "ProcessId = $Id" -ErrorAction SilentlyContinue
}

$listeners = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique)

if ($listeners.Count) {
    foreach ($id in $listeners) {
        $process = Get-ProcessInfo $id
        # With --reload the listener is a child of the uvicorn reloader (inside a cmd wrapper);
        # stopping only the child lets the reloader start it again, so take the parent too.
        $parent = if ($process) { Get-ProcessInfo $process.ParentProcessId } else { $null }
        $target = if ($parent -and $parent.CommandLine -match 'uvicorn') { $parent.ProcessId } else { $id }
        & taskkill.exe /T /F /PID $target 2>$null | Out-Null
        Write-Host "Servidor local detenido (PID $target, puerto $Port)."
    }
    for ($i = 0; $i -lt 20 -and (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue); $i++) { Start-Sleep -Milliseconds 250 }
    if (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) { throw "El puerto $Port sigue ocupado." }
    exit 0
}

if (-not (Test-Path -LiteralPath $python)) { throw "Falta el entorno del servidor ($python). Corre una vez .\build-and-run.ps1 -Server para crearlo." }
if (Test-Path -LiteralPath $log) { Remove-Item -LiteralPath $log -Force -ErrorAction SilentlyContinue }
$cmd = "cd /d `"$apiRoot`" && `"$python`" -m uvicorn app.main:app --host 127.0.0.1 --port $Port --reload --reload-dir app > `"$log`" 2>&1"
$server = Start-Process -FilePath 'cmd.exe' -ArgumentList '/d', '/s', '/c', $cmd -WindowStyle Hidden -PassThru

for ($i = 0; $i -lt 60; $i++) {
    Start-Sleep -Milliseconds 500
    try {
        if ((Invoke-RestMethod "$apiUrl/health" -TimeoutSec 2).ok) {
            Write-Host "Servidor local en marcha en $apiUrl (se reinicia solo al guardar). Panel: $apiUrl/admin/dashboard"
            Write-Host "Log: $log"
            exit 0
        }
    } catch {}
    if ($server.HasExited) { break }
}
& taskkill.exe /T /F /PID $server.Id 2>$null | Out-Null
throw "El servidor no arranco. Mira $log"
