<#
.SYNOPSIS
Kid mode proof of concept (vault/Modo niño.md, task MN.2): a standard local Windows account for a child, with Game
Access as its desktop, the disks hidden, and nothing able to run but Windows and installed programs until a game is
allowed.

.DESCRIPTION
Run it from PowerShell opened as administrator. It can be run again: an existing account is kept and its settings
are applied again. Everything lives in the child's own registry, under Policies, which a standard account cannot
change; no file on the disks is touched.

- Creates the account (standard user, password asked unless -NoPassword) and its profile, so its settings can be
  written before the first sign-in.
- Game Access replaces the Windows desktop (Winlogon Shell); Task Manager and Win+R are off.
- The disks are hidden and closed in Explorer and in programs' Open/Save dialogs (NoDrives, NoViewOnDrive).
- Software restriction policies: by default nothing runs; Windows, Program Files and Program Files (x86) may, except
  the game folders of the launchers that install there (Steam's steamapps, Epic, GOG) and web browsers. The most
  specific rule wins, so one game's folder can be allowed inside a blocked one.
- Logon hours (-Weekdays / -Weekend, local hours "from-to"); Windows itself keeps the child out of them.
- -Allow lets one game folder run for this account, as the SYSTEM service will do (MN.6); -Disallow takes it back.
- -Remove deletes the account and its profile (with everything above).
- -FromFamily <file> is what the adult's Game Access runs (kid mode screen, kid_mode.rs): the settings of one child
  in a JSON file (name, enabled, dailyMinutes, weekdays, weekend, games with their folders). It sets the account up as
  above (no password for a new one), lets exactly those game folders run, and writes %ProgramData%\GameAccess  familia.json, which only administrators can change and every account reads. A failure is written to <file>.error.

.EXAMPLE
powershell -ExecutionPolicy Bypass -File tools\windows\kid-account.ps1 -Name Prueba -Weekdays 16-20 -Weekend 10-21

.EXAMPLE
powershell -ExecutionPolicy Bypass -File tools\windows\kid-account.ps1 -Name Prueba -Allow "C:\GA_Juegos\233720-Surgeon_Simulator-ready"

.EXAMPLE
powershell -ExecutionPolicy Bypass -File tools\windows\kid-account.ps1 -Name Prueba -Remove
#>
[CmdletBinding(SupportsShouldProcess, ConfirmImpact = 'Medium', DefaultParameterSetName = 'Create')]
param(
    [Parameter(ParameterSetName = 'Create', Mandatory)][Parameter(ParameterSetName = 'Allow', Mandatory)]
    [Parameter(ParameterSetName = 'Disallow', Mandatory)][Parameter(ParameterSetName = 'Remove', Mandatory)]
    [ValidatePattern('^[A-Za-z0-9._-]{1,20}$')][string]$Name,
    [Parameter(ParameterSetName = 'Create')][string]$FullName,
    [Parameter(ParameterSetName = 'Create')][switch]$NoPassword,
    [Parameter(ParameterSetName = 'Create')][ValidatePattern('^\d{1,2}-\d{1,2}$')][string]$Weekdays,
    [Parameter(ParameterSetName = 'Create')][ValidatePattern('^\d{1,2}-\d{1,2}$')][string]$Weekend,
    [Parameter(ParameterSetName = 'Create')][string]$Shell,
    [Parameter(ParameterSetName = 'Allow', Mandatory)][string]$Allow,
    [Parameter(ParameterSetName = 'Disallow', Mandatory)][string]$Disallow,
    [Parameter(ParameterSetName = 'Remove', Mandatory)][switch]$Remove,
    [Parameter(ParameterSetName = 'Family', Mandatory)][string]$FromFamily
)
$ErrorActionPreference = 'Stop'

$UsersGroupSid = 'S-1-5-32-545'  # "Users" / "Usuarios", by SID so any Windows language works
$Safer = 'Software\Policies\Microsoft\Windows\Safer\CodeIdentifiers'
$Levels = @{ Disallowed = '0'; Unrestricted = '262144' }
$AllDrives = 0x03FFFFFF  # A: to Z:
$GameRule = 'Juego habilitado por Game Access'
# The installed app next to this script (runtime\kid-account.ps1), or the usual install folder.
if (-not $Shell) {
    $beside = Join-Path (Split-Path -Parent $PSScriptRoot) 'gameaccess-desktop.exe'
    $Shell = if (Test-Path -LiteralPath $beside) { $beside } else { Join-Path $env:ProgramFiles 'gameAccess\gameaccess-desktop.exe' }
}

$principal = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Hace falta PowerShell abierto como administrador.'
}

# Inside Program Files, but games or a way out to the internet: they stay closed.
function Get-ClosedFolders {
    $x86 = ${env:ProgramFiles(x86)}
    $steam = (Get-ItemProperty -LiteralPath 'HKLM:\SOFTWARE\WOW6432Node\Valve\Steam' -ErrorAction SilentlyContinue).InstallPath
    if (-not $steam) { $steam = Join-Path $x86 'Steam' }
    return @(
        (Join-Path $steam 'steamapps'),
        (Join-Path $env:ProgramFiles 'Epic Games'),
        (Join-Path $x86 'GOG Galaxy\Games'),
        (Join-Path $env:ProgramFiles 'Google\Chrome'),
        (Join-Path $x86 'Google\Chrome'),
        (Join-Path $x86 'Microsoft\Edge\Application'),
        (Join-Path $env:ProgramFiles 'Mozilla Firefox'),
        (Join-Path $x86 'Mozilla Firefox'),
        (Join-Path $env:ProgramFiles 'BraveSoftware'),
        (Join-Path $env:ProgramFiles 'Opera')
    )
}

function Get-KidSid {
    $user = Get-LocalUser -Name $Name -ErrorAction SilentlyContinue
    if (-not $user) { throw "No existe la cuenta $Name." }
    return $user.SID
}

# The account's profile folder, created now if the account never signed in.
function Get-KidProfile([Security.Principal.SecurityIdentifier]$Sid) {
    if (-not ('GameAccess.UserEnv' -as [type])) {
        Add-Type -Namespace GameAccess -Name UserEnv -MemberDefinition @'
[DllImport("userenv.dll", CharSet = CharSet.Unicode)]
public static extern int CreateProfile(string sid, string userName, System.Text.StringBuilder profilePath, uint size);
'@
    }
    $found = Get-CimInstance Win32_UserProfile -Filter "SID='$($Sid.Value)'"
    if ($found) { return $found.LocalPath }
    $path = New-Object System.Text.StringBuilder 260
    $result = [GameAccess.UserEnv]::CreateProfile($Sid.Value, $Name, $path, 260)
    if ($result -ne 0) { throw ('No se pudo crear el perfil de {0} (0x{1:X8}).' -f $Name, $result) }
    return $path.ToString()
}

# Runs $Write with the account's registry (HKCU) as a Registry:: path: its own hive when it is signed in, the
# profile's NTUSER.DAT loaded for the moment otherwise.
function Use-KidRegistry([Security.Principal.SecurityIdentifier]$Sid, [scriptblock]$Write) {
    $live = "Registry::HKEY_USERS\$($Sid.Value)"
    if (Test-Path -LiteralPath $live) { & $Write $live; return }
    $mount = "GameAccess-$Name"
    & reg.exe load "HKU\$mount" (Join-Path (Get-KidProfile $Sid) 'NTUSER.DAT') | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "No se pudo abrir el registro de $Name." }
    try { & $Write "Registry::HKEY_USERS\$mount" }
    finally {
        # The registry provider keeps handles until they are collected; unloading fails while they are open.
        [GC]::Collect(); [GC]::WaitForPendingFinalizers(); Start-Sleep -Milliseconds 500
        & reg.exe unload "HKU\$mount" | Out-Null
        if ($LASTEXITCODE -ne 0) { Write-Warning "El registro de $Name quedó abierto como HKU\$mount; se cierra al reiniciar." }
    }
}

function Set-Value([string]$Key, [string]$Value, $Data, [string]$Type) {
    if (-not (Test-Path -LiteralPath $Key)) { New-Item -Path $Key -Force | Out-Null }
    New-ItemProperty -LiteralPath $Key -Name $Value -Value $Data -PropertyType $Type -Force | Out-Null
}

# Takes away every rule for $Path, in both levels.
function Remove-PathRule([string]$Hkcu, [string]$Path) {
    foreach ($level in $Levels.Values) {
        $rules = "$Hkcu\$Safer\$level\Paths"
        if (-not (Test-Path -LiteralPath $rules)) { continue }
        Get-ChildItem -LiteralPath $rules | Where-Object { (Get-ItemProperty -LiteralPath $_.PSPath).ItemData -eq $Path } |
            Remove-Item -Recurse -Force
    }
}

# A software restriction path rule: the folder and everything inside it runs (Unrestricted) or not (Disallowed).
function Add-PathRule([string]$Hkcu, [string]$Level, [string]$Path, [string]$Description) {
    Remove-PathRule $Hkcu $Path
    $rule = "$Hkcu\$Safer\$($Levels[$Level])\Paths\{$([guid]::NewGuid())}"
    Set-Value $rule ItemData $Path String
    Set-Value $rule SaferFlags 0 DWord
    Set-Value $rule Description $Description String
    Set-Value $rule LastModified ([DateTime]::Now.ToFileTime()) QWord
}

# Allowed hours, as Windows keeps them: 21 bytes, one bit per hour of the week from Sunday 00:00 UTC.
function Set-LogonHours {
    if (-not $Weekdays -and -not $Weekend) { return }
    $offset = [int][TimeZoneInfo]::Local.BaseUtcOffset.TotalHours
    $bytes = New-Object byte[] 21
    foreach ($day in 0..6) {
        $range = if ($day -eq 0 -or $day -eq 6) { $Weekend } else { $Weekdays }
        $from, $to = if ($range) { $range.Split('-') | ForEach-Object { [int]$_ } } else { 0, 24 }
        if ($from -ge $to -or $to -gt 24) { throw "Horario inválido: $range (desde-hasta, entre 0 y 24)." }
        for ($hour = $from; $hour -lt $to; $hour++) {
            $bit = (($day * 24 + $hour - $offset) % 168 + 168) % 168
            $bytes[[math]::Floor($bit / 8)] = [byte]($bytes[[math]::Floor($bit / 8)] -bor (1 -shl ($bit % 8)))
        }
    }
    $account = [ADSI]"WinNT://$env:COMPUTERNAME/$Name,user"
    $account.Put('LoginHours', $bytes)
    $account.SetInfo()
}

switch ($PSCmdlet.ParameterSetName) {
    'Allow' {
        $folder = (Resolve-Path -LiteralPath $Allow).ProviderPath.TrimEnd('\')
        if ($PSCmdlet.ShouldProcess($folder, "Dejar que $Name ejecute")) {
            Use-KidRegistry (Get-KidSid) { param($hkcu) Add-PathRule $hkcu Unrestricted $folder $GameRule }
        }
        Write-Host "$Name puede ejecutar lo que hay en $folder (desde el próximo programa que abra)."
        return
    }
    'Disallow' {
        $folder = $Disallow.TrimEnd('\')
        if ($PSCmdlet.ShouldProcess($folder, "Quitarle a $Name el permiso de ejecutar")) {
            Use-KidRegistry (Get-KidSid) { param($hkcu) Remove-PathRule $hkcu $folder }
        }
        Write-Host "$Name ya no puede ejecutar lo que hay en $folder."
        return
    }
    'Remove' {
        $sid = Get-KidSid
        if (-not $PSCmdlet.ShouldProcess($Name, 'Borrar la cuenta y su perfil')) { return }
        # The profile holds the account's registry, and with it every rule above.
        Get-CimInstance Win32_UserProfile -Filter "SID='$($sid.Value)'" | Remove-CimInstance
        Remove-LocalUser -SID $sid
        Write-Host "Cuenta $Name borrada."
        return
    }
}

# Creates the account (or applies its settings again). Returns its SID.
function Set-KidAccount {
    if (-not (Test-Path -LiteralPath $Shell)) { Write-Warning "No está ${Shell}: instalá Game Access para toda la PC o pasá -Shell." }

    $user = Get-LocalUser -Name $Name -ErrorAction SilentlyContinue
    if (-not $user) {
        $options = @{ Name = $Name; AccountNeverExpires = $true; Description = 'Cuenta de niño de Game Access' }
        if ($FullName) { $options.FullName = $FullName }
        if ($NoPassword) { $options.NoPassword = $true }
        else {
            $options.Password = Read-Host -AsSecureString "Contraseña para $Name"
            $options.PasswordNeverExpires = $true
            $options.UserMayNotChangePassword = $true
        }
        $user = New-LocalUser @options
        Write-Host "Cuenta $Name creada."
    }
    $sid = $user.SID
    if (-not (Get-LocalGroupMember -SID $UsersGroupSid | Where-Object { $_.SID -eq $sid })) { Add-LocalGroupMember -SID $UsersGroupSid -Member $user }

    $open = @($env:SystemRoot, $env:ProgramFiles, ${env:ProgramFiles(x86)})
    $closed = Get-ClosedFolders
    Use-KidRegistry $sid {
        param($hkcu)
        $policies = "$hkcu\Software\Microsoft\Windows\CurrentVersion\Policies"
        # Quoted: the path has spaces. --kid-shell: Game Access opens again if it falls, and closing it signs out.
        Set-Value "$hkcu\Software\Microsoft\Windows NT\CurrentVersion\Winlogon" Shell ('"{0}" --kid-shell' -f $Shell) String
        Set-Value "$policies\System" DisableTaskMgr 1 DWord
        # Ctrl+Alt+Del cannot be taken away (Windows keeps it for itself): its screen only leaves "Sign out".
        Set-Value "$policies\System" DisableLockWorkstation 1 DWord
        Set-Value "$policies\System" DisableChangePassword 1 DWord
        Set-Value "$policies\Explorer" NoRun 1 DWord
        Set-Value "$policies\Explorer" NoDrives $AllDrives DWord
        Set-Value "$policies\Explorer" NoViewOnDrive $AllDrives DWord

        # Nothing runs by default (DefaultLevel 0); executables only, not their DLLs (TransparentEnabled 1).
        Set-Value "$hkcu\$Safer" DefaultLevel 0 DWord
        Set-Value "$hkcu\$Safer" TransparentEnabled 1 DWord
        Set-Value "$hkcu\$Safer" PolicyScope 0 DWord
        Set-Value "$hkcu\$Safer" AuthenticodeEnabled 0 DWord
        # Windows' own list of what counts as a program, without shortcuts (.lnk), which Windows opens by itself.
        Set-Value "$hkcu\$Safer" ExecutableTypes @('ADE', 'ADP', 'BAS', 'BAT', 'CHM', 'CMD', 'COM', 'CPL', 'CRT', 'EXE', 'HLP', 'HTA', 'INF', 'INS', 'ISP', 'MDB', 'MDE', 'MSC', 'MSI', 'MSP', 'MST', 'OCX', 'PCD', 'PIF', 'REG', 'SCR', 'SHS', 'URL', 'VB', 'WSC') MultiString
        # The screen's scaling is kept per account: the child gets the adult's (the one running this script), not the
        # default of a new account.
        $scaling = 'HKCU:\Control Panel\Desktop\PerMonitorSettings'
        if (Test-Path -LiteralPath $scaling) {
            foreach ($monitor in Get-ChildItem -LiteralPath $scaling) {
                $dpi = (Get-ItemProperty -LiteralPath $monitor.PSPath).DpiValue
                if ($null -ne $dpi) { Set-Value "$hkcu\Control Panel\Desktop\PerMonitorSettings\$($monitor.PSChildName)" DpiValue $dpi DWord }
            }
        }
        foreach ($folder in $open) { Add-PathRule $hkcu Unrestricted $folder 'Windows y programas instalados' }
        foreach ($folder in $closed) { Add-PathRule $hkcu Disallowed $folder 'Juegos o navegador: cerrado salvo lo que habilite Game Access' }
    }
    Write-Host "Escritorio de ${Name}: $Shell. Administrador de tareas y Ejecutar deshabilitados. Discos ocultos."
    Write-Host "Solo se ejecuta lo que está en: $($open -join ', ')."
    Write-Host "Salvo: $($closed -join ', ')."

    Set-LogonHours
    return $sid
}

# The family file: this child's settings next to the other children's. Only administrators write it; every account
# reads it (the child's Game Access finds itself in it by its SID).
function Write-Family($Request, [Security.Principal.SecurityIdentifier]$Sid, $Games) {
    $dir = Join-Path $env:ProgramData 'GameAccess'
    New-Item -ItemType Directory -Path $dir -Force | Out-Null
    $acl = New-Object Security.AccessControl.DirectorySecurity
    $acl.SetAccessRuleProtection($true, $false)
    foreach ($admin in 'S-1-5-18', 'S-1-5-32-544') {
        $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule((New-Object Security.Principal.SecurityIdentifier $admin), 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')))
    }
    $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule((New-Object Security.Principal.SecurityIdentifier $UsersGroupSid), 'ReadAndExecute', 'ContainerInherit,ObjectInherit', 'None', 'Allow')))
    (Get-Item -LiteralPath $dir).SetAccessControl($acl)
    $path = Join-Path $dir 'familia.json'
    $others = @()
    if (Test-Path -LiteralPath $path) {
        $others = @((Get-Content -LiteralPath $path -Raw -Encoding UTF8 | ConvertFrom-Json).kids | Where-Object { $_ -and $_.sid -ne $Sid.Value })
    }
    $kid = [ordered]@{
        name = $Name; sid = $Sid.Value; enabled = [bool]$Request.enabled; dailyMinutes = [int]$Request.dailyMinutes
        weekdays = $Weekdays; weekend = $Weekend
        games = @($Games | ForEach-Object {
            [ordered]@{ appId = [int]$_.appId; name = [string]$_.name; folder = [string]$_.folder; executable = [string]$_.executable
                arguments = @($_.arguments | Where-Object { $null -ne $_ } | ForEach-Object { [string]$_ }); steam = [bool]$_.steam }
        })
    }
    $family = [ordered]@{ version = 1; kids = @($others + $kid) }
    [IO.File]::WriteAllText($path, (ConvertTo-Json -InputObject $family -Depth 8), (New-Object Text.UTF8Encoding $false))
}

if ($PSCmdlet.ParameterSetName -eq 'Family') {
    try {
        $request = [IO.File]::ReadAllText($FromFamily) | ConvertFrom-Json
        $Name = [string]$request.name
        $Weekdays = if ($request.weekdays) { [string]$request.weekdays } else { '0-24' }
        $Weekend = if ($request.weekend) { [string]$request.weekend } else { '0-24' }
        $NoPassword = $true
        $sid = Set-KidAccount
        if ($request.enabled) { Enable-LocalUser -SID $sid } else { Disable-LocalUser -SID $sid }
        $games = @($request.games | Where-Object { $_ -and $_.folder })
        # Exactly the chosen games may run: the earlier choice goes, the folders of this one come in.
        Use-KidRegistry $sid {
            param($hkcu)
            $rules = "$hkcu\$Safer\$($Levels.Unrestricted)\Paths"
            if (Test-Path -LiteralPath $rules) {
                Get-ChildItem -LiteralPath $rules | Where-Object { (Get-ItemProperty -LiteralPath $_.PSPath).Description -eq $GameRule } | Remove-Item -Recurse -Force
            }
            foreach ($game in $games) { Add-PathRule $hkcu Unrestricted ([string]$game.folder).TrimEnd('') $GameRule }
        }
        Write-Family $request $sid $games
        exit 0
    } catch {
        [IO.File]::WriteAllText("$FromFamily.error", $_.Exception.Message)
        exit 1
    }
}

# Create (or apply again).
if (-not $PSCmdlet.ShouldProcess($Name, 'Crear o actualizar la cuenta de niño')) { return }
[void](Set-KidAccount)

Write-Host ''
& net.exe user $Name | Select-String -Pattern '^(Logon hours|Horas de inicio)' -Context 0, 6
Write-Host ''
Write-Host 'Para probar: cerrá sesión y entrá como el niño. Habilitá un juego con -Allow "<carpeta del juego>".'
Write-Host 'Si la pantalla queda en negro al cerrar Game Access: Ctrl+Alt+Supr -> Cerrar sesión.'
