param([switch]$Elevated)

# Auto-elevate to Administrator
if (-not $Elevated) {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = [Security.Principal.WindowsPrincipal]$identity
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        Write-Host "Solicitando privilegios de Administrador..."
        Start-Process powershell.exe -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`" -Elevated" -Verb RunAs
        exit
    }
}

$WorkspaceDir = "C:\DEV\Game Access Dev"
$ProcmonPath = "$WorkspaceDir\procmon64.exe"
$PmlFile = "$WorkspaceDir\trace.pml"
$CsvFile = "$WorkspaceDir\trace.csv"

# Download Procmon if not exists
if (-not (Test-Path $ProcmonPath)) {
    Write-Host "Descargando Procmon64 desde Sysinternals..."
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    Invoke-WebRequest -Uri "https://live.sysinternals.com/procmon64.exe" -OutFile $ProcmonPath
}

# Clean old trace files
if (Test-Path $PmlFile) { Remove-Item $PmlFile -Force }
if (Test-Path $CsvFile) { Remove-Item $CsvFile -Force }

Write-Host "--------------------------------------------------------"
Write-Host "Iniciando Process Monitor de forma silenciosa..."
Start-Process -FilePath $ProcmonPath -ArgumentList "/AcceptEula", "/Quiet", "/Minimized", "/BackingFile", "`"$PmlFile`""

Write-Host ""
Write-Host ">>> PROCMON ESTA GRABANDO EN SEGUNDO PLANO <<<"
Write-Host "1. Ve a tu launcher y presiona JUGAR en Trine 5."
Write-Host "2. Espera a que se abra la pagina web/popup."
Write-Host "3. Vuelve a esta ventana y presiona ENTER para detener la grabacion."
Write-Host "--------------------------------------------------------"
Read-Host "Presiona ENTER aqui cuando se haya abierto el navegador..."

Write-Host "Deteniendo Procmon..."
Start-Process -FilePath $ProcmonPath -ArgumentList "/Terminate" -Wait

Write-Host "Convirtiendo captura a CSV para que Antigravity la analice (puede tardar un minuto)..."
Start-Process -FilePath $ProcmonPath -ArgumentList "/AcceptEula", "/OpenLog", "`"$PmlFile`"", "/SaveAs", "`"$CsvFile`"" -Wait

Write-Host "Limpiando archivo temporal PML..."
Remove-Item $PmlFile -Force

Write-Host "¡Todo listo! Ya puedes volver al chat para que analice el resultado."
Read-Host "Presiona ENTER para cerrar..."
