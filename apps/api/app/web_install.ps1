<#
  Game Access: install from the website (vault/Instalador web.md). Open source, read it before running it.

  The website gives you a one-line command with a code: powershell -nop -c "irm <server>/i/<code>|iex".
  The server fills in the five values below and this script, in order:
    1. tells the page it is running (the page shows each step live);
    2. checks Windows (64 bits, Windows 10 1809 or later) and that Smart App Control is not blocking new apps;
       installs Microsoft's WebView2 runtime (what Game Access draws its window with) when it is not really there;
    3. checks that Steam is installed (Game Access needs it; installing Steam is up to the player);
    4. downloads the Game Access installer named below and checks its SHA-256: anything else is never run;
    5. runs it silently (Windows asks for permission once) and opens Game Access.
  It sends only the step, its state and a short reason (for example "uac_declined"): no user name, no files.
#>
$Api = '__API__'
$Code = '__CODE__'
$InstallerUrl = '__URL__'
$InstallerSha256 = '__SHA256__'
$Version = '__VERSION__'

& {
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
$Host.UI.RawUI.WindowTitle = 'Game Access'

# The step in course: an unexpected error is shown on it.
$now = @{ Step = 'connected' }

function Send-Step([string] $Step, [string] $State, [string] $Detail = '', $Progress = $null) {
  if ($State -eq 'running') { $now.Step = $Step }
  $body = @{ step = $Step; state = $State; detail = $Detail }
  if ($null -ne $Progress) { $body.progress = [int] $Progress }
  try {
    Invoke-RestMethod -Method Post -Uri "$Api/install/sessions/$Code/events" -ContentType 'application/json' `
      -Body ($body | ConvertTo-Json -Compress) -TimeoutSec 15 | Out-Null
  } catch { }
}

function Say([string] $Text, [string] $Color = 'Gray') { Write-Host "  $Text" -ForegroundColor $Color }

# Stops the install: the page shows the reason, the window says it too.
function Stop-Install([string] $Step, [string] $Reason, [string] $Text) {
  Send-Step $Step 'error' $Reason
  throw [System.OperationCanceledException]::new($Text)
}

# Runs an installer as administrator and waits. Windows' permission question answered "No" stops the install.
function Start-Elevated([string] $Step, [string] $File, [string] $Arguments) {
  try {
    $process = Start-Process -FilePath $File -ArgumentList $Arguments -Verb RunAs -Wait -PassThru
  } catch {
    Stop-Install $Step 'uac_declined' 'Windows no recibio el permiso. Volve a pegar el comando y toca "Si".'
  }
  return $process.ExitCode
}

# WebView2 counts as installed only when its registry entry names a version whose files exist: Game Access's installer
# trusts the entry alone, and a Windows with the entry but without the runtime (Windows Sandbox) opens a broken app.
function Test-WebView2 {
  $guid = '{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}'
  foreach ($key in "HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\$guid", "HKCU:\SOFTWARE\Microsoft\EdgeUpdate\Clients\$guid") {
    $version = (Get-ItemProperty $key -ErrorAction SilentlyContinue).pv
    if (-not $version -or $version -eq '0.0.0.0') { continue }
    foreach ($base in "${env:ProgramFiles(x86)}\Microsoft\EdgeWebView\Application", "$env:LOCALAPPDATA\Microsoft\EdgeWebView\Application") {
      if (Test-Path (Join-Path $base "$version\msedgewebview2.exe")) { return $true }
    }
  }
  return $false
}

function Find-Steam {
  $path = (Get-ItemProperty 'HKCU:\Software\Valve\Steam' -ErrorAction SilentlyContinue).SteamPath
  if (-not $path) { $path = (Get-ItemProperty 'HKLM:\SOFTWARE\WOW6432Node\Valve\Steam' -ErrorAction SilentlyContinue).InstallPath }
  if (-not $path -and (Test-Path "${env:ProgramFiles(x86)}\Steam\steam.exe")) { $path = "${env:ProgramFiles(x86)}\Steam" }
  return $path
}

# The installed Game Access: its uninstall entry (version and folder), or the executable in the usual folders.
function Find-GameAccess {
  $roots = 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*', 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*',
           'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*'
  $entry = Get-ItemProperty $roots -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -match '^game ?access' } | Select-Object -First 1
  $exe = $null
  if ($entry -and $entry.InstallLocation) {
    $candidate = Join-Path ($entry.InstallLocation.Trim('"')) 'gameaccess-desktop.exe'
    if (Test-Path $candidate) { $exe = $candidate }
  }
  if (-not $exe) {
    foreach ($root in @($env:ProgramFiles, ${env:ProgramFiles(x86)}, (Join-Path $env:LOCALAPPDATA 'Programs'))) {
      $found = Get-ChildItem $root -Recurse -Depth 2 -Filter 'gameaccess-desktop.exe' -ErrorAction SilentlyContinue | Select-Object -First 1
      if ($found) { $exe = $found.FullName; break }
    }
  }
  $installed = $null
  if ($entry -and $entry.DisplayVersion) { try { $installed = [version] $entry.DisplayVersion } catch { } }
  return @{ Exe = $exe; Version = $installed }
}

# Streams the file to disk and tells the page how far it is, about once a second.
function Get-WithProgress([string] $Url, [string] $File) {
  Add-Type -AssemblyName System.Net.Http
  $client = New-Object System.Net.Http.HttpClient
  $client.Timeout = [TimeSpan]::FromMinutes(30)
  $response = $client.GetAsync($Url, [System.Net.Http.HttpCompletionOption]::ResponseHeadersRead).GetAwaiter().GetResult()
  if (-not $response.IsSuccessStatusCode) { Stop-Install 'download' "http_$([int] $response.StatusCode)" 'No se pudo bajar el instalador.' }
  $total = $response.Content.Headers.ContentLength
  $stream = $response.Content.ReadAsStreamAsync().GetAwaiter().GetResult()
  $output = [IO.File]::Create($File)
  try {
    $buffer = New-Object byte[] 262144
    $done = 0L
    $clock = [Diagnostics.Stopwatch]::StartNew()
    while (($read = $stream.Read($buffer, 0, $buffer.Length)) -gt 0) {
      $output.Write($buffer, 0, $read)
      $done += $read
      if ($clock.ElapsedMilliseconds -ge 1000) {
        $clock.Restart()
        $percent = if ($total) { [int] (100 * $done / $total) } else { $null }
        $megabytes = [math]::Round($done / 1MB)
        Send-Step 'download' 'running' ("$megabytes/" + $(if ($total) { [math]::Round($total / 1MB) } else { '?' })) $percent
      }
    }
  } finally {
    $output.Dispose(); $stream.Dispose(); $client.Dispose()
  }
}

try {
  Write-Host ''
  Say 'GAME ACCESS' 'DarkYellow'
  Say 'Segui en la pagina: ahi ves cada paso.' 'White'
  Write-Host ''
  Send-Step 'connected' 'ok'

  if (-not $InstallerUrl -or $InstallerSha256 -notmatch '^[0-9a-f]{64}$') {
    Stop-Install 'connected' 'no_release' 'Todavia no hay una version publicada para instalar.'
  }

  Send-Step 'windows' 'running'
  $build = [Environment]::OSVersion.Version.Build
  if (-not [Environment]::Is64BitOperatingSystem -or $build -lt 17763) {
    Stop-Install 'windows' 'windows_old' 'Game Access necesita Windows 10 (1809 o mas nuevo) u 11, de 64 bits.'
  }
  Send-Step 'windows' 'ok'
  Say 'Windows compatible' 'Green'

  # Smart App Control on (1) blocks every new unsigned app, Game Access included; evaluation mode (2) does not.
  $sac = (Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\CI\Policy' -ErrorAction SilentlyContinue).VerifiedAndReputablePolicyState
  if ($sac -eq 1) { Stop-Install 'smartapp' 'sac_on' 'Smart App Control esta encendido: hoy bloquea Game Access.' }
  Send-Step 'smartapp' 'ok'

  Send-Step 'webview' 'running'
  if (Test-WebView2) {
    Send-Step 'webview' 'ok' 'found'
  } else {
    Say 'Instalando WebView2 de Microsoft...' 'White'
    $webviewSetup = Join-Path $env:TEMP 'MicrosoftEdgeWebview2Setup.exe'
    Invoke-WebRequest -UseBasicParsing 'https://go.microsoft.com/fwlink/p/?LinkId=2124703' -OutFile $webviewSetup
    $signature = Get-AuthenticodeSignature $webviewSetup
    if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch 'O=Microsoft Corporation') {
      Stop-Install 'webview' 'webview_unsigned' 'El instalador de WebView2 no tiene la firma de Microsoft.'
    }
    Send-Step 'webview' 'running' 'installing'
    Start-Elevated 'webview' $webviewSetup '/silent /install' | Out-Null
    if (-not (Test-WebView2)) { Stop-Install 'webview' 'webview_failed' 'WebView2 no quedo instalado.' }
    Send-Step 'webview' 'ok' 'installed'
  }
  Say 'WebView2 listo' 'Green'

  $current = Find-GameAccess
  $target = $null
  if ($Version) { try { $target = [version] $Version } catch { } }
  $upToDate = $current.Exe -and $current.Version -and $target -and $current.Version -ge $target

  Send-Step 'steam' 'running'
  if (Find-Steam) {
    Send-Step 'steam' 'ok' 'found'
    Say 'Steam encontrado' 'Green'
  } else {
    Stop-Install 'steam' 'steam_missing' 'Game Access necesita Steam. Instalalo desde store.steampowered.com y volve a pegar el comando.'
  }

  if ($upToDate) {
    foreach ($step in 'download', 'verify', 'install') { Send-Step $step 'skip' 'installed' }
    Say "Game Access $($current.Version) ya estaba instalado" 'Green'
  } else {
    $folder = Join-Path $env:TEMP 'GameAccessSetup'
    New-Item -ItemType Directory -Force $folder | Out-Null
    $name = [IO.Path]::GetFileName(([Uri] $InstallerUrl).AbsolutePath)
    if ($name -notmatch '^[\w.\-]+\.exe$') { $name = 'gameaccess-setup.exe' }
    $setup = Join-Path $folder $name

    Send-Step 'download' 'running' '' 0
    Say "Bajando Game Access $Version..." 'White'
    Get-WithProgress $InstallerUrl $setup
    Send-Step 'download' 'ok' '' 100

    Send-Step 'verify' 'running'
    if ((Get-FileHash $setup -Algorithm SHA256).Hash.ToLower() -ne $InstallerSha256) {
      Remove-Item $setup -Force -ErrorAction SilentlyContinue
      Stop-Install 'verify' 'hash_mismatch' 'El archivo bajado no es el publicado: no se ejecuta.'
    }
    Send-Step 'verify' 'ok'
    Say 'Archivo verificado' 'Green'

    Send-Step 'install' 'running'
    Say 'Instalando (Windows te pide permiso: toca "Si")...' 'White'
    $exitCode = Start-Elevated 'install' $setup '/S'
    if ($exitCode -ne 0) { Stop-Install 'install' "exit_$exitCode" 'El instalador de Game Access no termino bien.' }
    Remove-Item $setup -Force -ErrorAction SilentlyContinue
    $current = Find-GameAccess
    if (-not $current.Exe) { Stop-Install 'install' 'not_found' 'Game Access no aparece instalado.' }
    Send-Step 'install' 'ok'
    Say 'Game Access instalado' 'Green'
  }

  Send-Step 'open' 'running'
  Start-Process -FilePath $current.Exe
  Send-Step 'open' 'ok'
  Write-Host ''
  Say 'Listo. Game Access se esta abriendo.' 'DarkYellow'
  Start-Sleep -Seconds 3
} catch {
  if ($_.Exception -isnot [System.OperationCanceledException]) {
    Send-Step $now.Step 'error' 'unexpected'
  }
  Write-Host ''
  Say $_.Exception.Message 'Red'
  Say 'Mira la pagina para ver que hacer. Presiona Enter para cerrar.' 'Gray'
  [void] (Read-Host)
}
}
