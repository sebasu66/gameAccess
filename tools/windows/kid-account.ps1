<#
.SYNOPSIS
Kid mode (vault/Modo niño.md): a local Windows account for a child with Game Access as its desktop (a kiosk), the
disks hidden, and the child's games playable exactly as on the adult's account.

.DESCRIPTION
Run it from PowerShell opened as administrator. It can be run again: an existing account is kept and its settings
are applied again. Everything lives in the child's own registry, under Policies, which a standard account cannot
change; no file on the disks is touched.

- Creates the account (standard user, password asked unless -NoPassword) and its profile, so its settings can be
  written before the first sign-in.
- Game Access replaces the Windows desktop (Winlogon Shell); Task Manager and Win+R are off.
- The disks are hidden and closed in Explorer and in programs' Open/Save dialogs (NoDrives, NoViewOnDrive).
- No software restriction policies (2026-10-30, Seba): the kiosk is the limit, and games must run as they do for the
  adult (their fix, launchers, tools). An account set up before keeps none: they are removed.
- Logon hours (-Weekdays / -Weekend, local hours "from-to"); Windows itself keeps the child out of them.
- -Remove deletes the account and its profile (with everything above), and takes the child out of the family file.
- -RemoveAll is what the uninstaller runs: every child in the family file loses its account and profile, and
  %ProgramData%\GameAccess goes (a child's desktop without Game Access would be a black screen).
- -FromFamily <file> is what the adult's Game Access runs (kid mode screen, kid_mode.rs): the settings of one child
  in a JSON file (name, enabled, dailyMinutes, weekdays, weekend, library, games with their folders). It sets the
  account up as above (no password for a new one), lets it write the games' folders and the adult's library (the child
  plays with the library's own play: fix, language, before-play steps), makes it an administrator when a game asks to
  run as one (Windows then asks the child to confirm, with no password), and writes %ProgramData%\GameAccess\familia.json,
  which only administrators can change and every account reads. A failure is written to <file>.error.

.EXAMPLE
powershell -ExecutionPolicy Bypass -File tools\windows\kid-account.ps1 -Name Prueba -Weekdays 16-20 -Weekend 10-21

.EXAMPLE
powershell -ExecutionPolicy Bypass -File tools\windows\kid-account.ps1 -Name Prueba -Remove
#>
[CmdletBinding(SupportsShouldProcess, ConfirmImpact = 'Medium', DefaultParameterSetName = 'Create')]
param(
    [Parameter(ParameterSetName = 'Create', Mandatory)][Parameter(ParameterSetName = 'Remove', Mandatory)]
    [ValidatePattern('^[A-Za-z0-9._-]{1,20}$')][string]$Name,
    [Parameter(ParameterSetName = 'Create')][string]$FullName,
    [Parameter(ParameterSetName = 'Create')][switch]$NoPassword,
    [Parameter(ParameterSetName = 'Create')][ValidatePattern('^\d{1,2}-\d{1,2}$')][string]$Weekdays,
    [Parameter(ParameterSetName = 'Create')][ValidatePattern('^\d{1,2}-\d{1,2}$')][string]$Weekend,
    [Parameter(ParameterSetName = 'Create')][string]$Shell,
    [Parameter(ParameterSetName = 'Remove', Mandatory)][switch]$Remove,
    [Parameter(ParameterSetName = 'Family', Mandatory)][string]$FromFamily,
    [Parameter(ParameterSetName = 'RemoveAll', Mandatory)][switch]$RemoveAll
)
$ErrorActionPreference = 'Stop'

$UsersGroupSid = 'S-1-5-32-545'  # "Users" / "Usuarios", by SID so any Windows language works
$AdminsGroupSid = 'S-1-5-32-544'
# Software restriction policies of earlier versions, taken away from an account set up then.
$AllDrives = 0x03FFFFFF  # A: to Z:
# The installed app next to this script (runtime\kid-account.ps1), or the usual install folder.
if (-not $Shell) {
    $beside = Join-Path (Split-Path -Parent $PSScriptRoot) 'gameaccess-desktop.exe'
    $Shell = if (Test-Path -LiteralPath $beside) { $beside } else { Join-Path $env:ProgramFiles 'gameAccess\gameaccess-desktop.exe' }
}

$principal = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    $message = 'Hace falta PowerShell abierto como administrador.'
    # Run by Game Access, the failure has to reach it (and its log) like any other.
    if ($FromFamily) {
        [IO.File]::AppendAllText("$FromFamily.log", ('{0} ERROR: {1} (corre como {2}){3}' -f (Get-Date -Format 'HH:mm:ss.fff'), $message, [Security.Principal.WindowsIdentity]::GetCurrent().Name, [Environment]::NewLine))
        [IO.File]::WriteAllText("$FromFamily.error", $message)
        exit 1
    }
    throw $message
}

# Each step, with its time, to "<request>.log" when Game Access runs this (it copies the lines into its own log
# afterwards: the account is made out of sight, and this is how anyone can tell what happened).
function Write-Step([string]$Text) {
    Write-Host $Text
    if ($FromFamily) { [IO.File]::AppendAllText("$FromFamily.log", ('{0} {1}{2}' -f (Get-Date -Format 'HH:mm:ss.fff'), $Text, [Environment]::NewLine)) }
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

# The family file's folder, and what the children leave in it: their time and the adult's live orders (uso\<sid>*).
$FamilyDir = Join-Path $env:ProgramData 'GameAccess'

function Read-FamilyKids {
    $file = Join-Path $FamilyDir 'familia.json'
    if (-not (Test-Path -LiteralPath $file)) { return @() }
    return @((Get-Content -LiteralPath $file -Raw -Encoding UTF8 | ConvertFrom-Json).kids | Where-Object { $_ })
}

# Takes one child out of the family file and deletes its time and orders.
function Remove-KidFromFamily([string]$SidValue) {
    $left = @(Read-FamilyKids | Where-Object { $_.sid -ne $SidValue })
    if (Test-Path -LiteralPath $FamilyDir) {
        $family = [ordered]@{ version = 1; kids = $left }
        [IO.File]::WriteAllText((Join-Path $FamilyDir 'familia.json'), (ConvertTo-Json -InputObject $family -Depth 8), (New-Object Text.UTF8Encoding $false))
    }
    Get-ChildItem -LiteralPath (Join-Path $FamilyDir 'uso') -Filter "$SidValue*" -ErrorAction SilentlyContinue | Remove-Item -Force
}

# The account and its profile (with its registry: every rule), then its entry in the family file. It fails while the
# child is signed in (its profile is in use).
function Remove-KidAccount([Security.Principal.SecurityIdentifier]$KidSid) {
    Get-CimInstance Win32_UserProfile -Filter "SID='$($KidSid.Value)'" | Remove-CimInstance
    Remove-LocalUser -SID $KidSid
    Remove-KidFromFamily $KidSid.Value
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

# Allowed hours, as Windows keeps them: 21 bytes, one bit per hour of the week from Sunday 00:00 UTC.
function Set-LogonHours {
    if (-not $Weekdays -and -not $Weekend -and -not $Days) { return }
    $offset = [int][TimeZoneInfo]::Local.BaseUtcOffset.TotalHours
    $bytes = New-Object byte[] 21
    foreach ($day in 0..6) {
        # Each day its own hours when the request has the seven (Sunday first, as here); else weekdays and weekend.
        $range = if (@($Days).Count -eq 7) { '{0}-{1}' -f [int]$Days[$day].from, [int]$Days[$day].to } elseif ($day -eq 0 -or $day -eq 6) { $Weekend } else { $Weekdays }
        $from, $to = if ($range) { $range.Split('-') | ForEach-Object { [int]$_ } } else { 0, 24 }
        if ($from -ge $to -or $to -gt 24) { throw "Horario inválido: $range (desde-hasta, entre 0 y 24)." }
        for ($hour = $from; $hour -lt $to; $hour++) {
            $bit = (($day * 24 + $hour - $offset) % 168 + 168) % 168
            $bytes[[math]::Floor($bit / 8)] = [byte]($bytes[[math]::Floor($bit / 8)] -bor (1 -shl ($bit % 8)))
        }
    }
    $account = [ADSI]"WinNT://$env:COMPUTERNAME/$Name,user"
    # Put and SetInfo hand back an empty value; it must not end up in a function's result (the SID).
    [void]$account.Put('LoginHours', $bytes)
    [void]$account.SetInfo()
    $shown = if (@($Days).Count -eq 7) { ($Days | ForEach-Object { '{0}-{1}' -f $_.from, $_.to }) -join ' ' } else { "lunes a viernes $Weekdays, fin de semana $Weekend" }
    Write-Step "Horas de inicio de sesión (domingo a sábado): $shown."
}

switch ($PSCmdlet.ParameterSetName) {
    'Remove' {
        $sid = Get-KidSid
        if (-not $PSCmdlet.ShouldProcess($Name, 'Borrar la cuenta y su perfil')) { return }
        # The profile holds the account's registry, and with it every rule above.
        Remove-KidAccount $sid
        Write-Host "Cuenta $Name borrada."
        return
    }
    'RemoveAll' {
        foreach ($kid in Read-FamilyKids) {
            $account = Get-LocalUser -SID $kid.sid -ErrorAction SilentlyContinue
            if (-not $account) { continue }
            try { Remove-KidAccount $account.SID } catch { Write-Warning "No se pudo borrar la cuenta $($account.Name): $($_.Exception.Message)" }
        }
        Remove-Item -LiteralPath $FamilyDir -Recurse -Force -ErrorAction SilentlyContinue
        return
    }
}

# Creates the account (or applies its settings again). Returns its SID.
function Set-KidAccount {
    if (-not (Test-Path -LiteralPath $Shell)) { Write-Warning "No está ${Shell}: instalá Game Access para toda la PC o pasá -Shell."; Write-Step "Aviso: no existe el escritorio del niño $Shell." }
    else { Write-Step "Escritorio del niño: $Shell." }

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
        Write-Step "Creando la cuenta de Windows $Name (sin contraseña: $([bool]$NoPassword))."
        $user = New-LocalUser @options
        Write-Step "Cuenta $Name creada (SID $($user.SID))."
    } else { Write-Step "La cuenta $Name ya existe (SID $($user.SID), habilitada: $($user.Enabled)): se actualiza." }
    $sid = $user.SID
    if (-not (Get-LocalGroupMember -SID $UsersGroupSid | Where-Object { $_.SID -eq $sid })) { Add-LocalGroupMember -SID $UsersGroupSid -Member $user; Write-Step "Agregada al grupo Usuarios." }

    Write-Step "Configurando el registro de la cuenta (escritorio y bloqueos)."
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

        # Earlier versions let nothing run outside Windows, Program Files and the allowed games: that goes.
        $restriction = "$hkcu\Software\Policies\Microsoft\Windows\Safer"
        if (Test-Path -LiteralPath $restriction) { Remove-Item -LiteralPath $restriction -Recurse -Force }
        # The screen's scaling is kept per account: the child gets the adult's (the one running this script), not the
        # default of a new account.
        $scaling = 'HKCU:\Control Panel\Desktop\PerMonitorSettings'
        if (Test-Path -LiteralPath $scaling) {
            foreach ($monitor in Get-ChildItem -LiteralPath $scaling) {
                $dpi = (Get-ItemProperty -LiteralPath $monitor.PSPath).DpiValue
                if ($null -ne $dpi) { Set-Value "$hkcu\Control Panel\Desktop\PerMonitorSettings\$($monitor.PSChildName)" DpiValue $dpi DWord }
            }
        }
    }
    Write-Host "Escritorio de ${Name}: $Shell. Administrador de tareas y Ejecutar deshabilitados. Discos ocultos."
    Write-Step "Registro listo: escritorio Game Access, sin administrador de tareas ni Ejecutar, discos ocultos."

    Set-LogonHours
    return $sid
}

# Lets the child's account change a folder and everything in it (inherited by what is made there later).
function Grant-Write([string]$Folder, [Security.Principal.SecurityIdentifier]$Sid) {
    $acl = Get-Acl -LiteralPath $Folder
    $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($Sid, 'Modify', 'ContainerInherit,ObjectInherit', 'None', 'Allow')))
    Set-Acl -LiteralPath $Folder -AclObject $acl
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
    # The child's time and the adult's live orders (kid_mode.rs): the one folder every account may write, so the
    # child's Game Access counts its time there and the adult's reads it and sends orders. Not a place for settings.
    $shared = Join-Path $dir 'uso'
    New-Item -ItemType Directory -Path $shared -Force | Out-Null
    $open = New-Object Security.AccessControl.DirectorySecurity
    $open.SetAccessRuleProtection($true, $false)
    foreach ($account in 'S-1-5-18', 'S-1-5-32-544', $UsersGroupSid) {
        $open.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule((New-Object Security.Principal.SecurityIdentifier $account), $(if ($account -eq $UsersGroupSid) { 'Modify' } else { 'FullControl' }), 'ContainerInherit,ObjectInherit', 'None', 'Allow')))
    }
    (Get-Item -LiteralPath $shared).SetAccessControl($open)
    $path = Join-Path $dir 'familia.json'
    $others = @()
    if (Test-Path -LiteralPath $path) {
        $others = @((Get-Content -LiteralPath $path -Raw -Encoding UTF8 | ConvertFrom-Json).kids | Where-Object { $_ -and $_.sid -ne $Sid.Value })
    }
    $kid = [ordered]@{
        name = $Name; sid = $Sid.Value; enabled = [bool]$Request.enabled; dailyMinutes = [int]$Request.dailyMinutes
        weekdays = $Weekdays; weekend = $Weekend; library = [string]$Request.library
        days = @($Days | Where-Object { $_ } | ForEach-Object { [ordered]@{ minutes = [int]$_.minutes; from = [int]$_.from; to = [int]$_.to } })
        games = @($Games | ForEach-Object {
            [ordered]@{ appId = [int]$_.appId; name = [string]$_.name; folder = [string]$_.folder; executable = [string]$_.executable
                arguments = @($_.arguments | Where-Object { $null -ne $_ } | ForEach-Object { [string]$_ }); steam = [bool]$_.steam; dailyMinutes = [int]$_.dailyMinutes
                administrator = [bool]$_.administrator }
        })
    }
    $family = [ordered]@{ version = 1; kids = @($others + $kid) }
    [IO.File]::WriteAllText($path, (ConvertTo-Json -InputObject $family -Depth 8), (New-Object Text.UTF8Encoding $false))
}

if ($PSCmdlet.ParameterSetName -eq 'Family') {
    try {
        $request = [IO.File]::ReadAllText($FromFamily) | ConvertFrom-Json
        $Name = [string]$request.name
        $admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
        Write-Step "Script de la cuenta de niño: $(if ($request.remove) { 'quitar' } else { 'crear o actualizar' }) $Name. Corre como $([Security.Principal.WindowsIdentity]::GetCurrent().Name) (administrador: $admin), PowerShell $($PSVersionTable.PSVersion)."
        if ($request.remove) {
            # Undo kid mode for this child. The account may be gone already: its entry in the family file still goes.
            $account = Get-LocalUser -Name $Name -ErrorAction SilentlyContinue
            if ($account) { Write-Step "Borrando la cuenta $Name y su perfil."; Remove-KidAccount $account.SID }
            else { Write-Step "La cuenta $Name ya no existe: solo se la saca del archivo de la familia."; foreach ($kid in Read-FamilyKids | Where-Object { $_.name -eq $Name }) { Remove-KidFromFamily $kid.sid } }
            Write-Step "Listo: modo niño quitado para $Name."
            exit 0
        }
        $Weekdays = if ($request.weekdays) { [string]$request.weekdays } else { '0-24' }
        $Weekend = if ($request.weekend) { [string]$request.weekend } else { '0-24' }
        $Days = @($request.days | Where-Object { $_ })
        $NoPassword = $true
        [void](Set-KidAccount)
        $sid = (Get-LocalUser -Name $Name).SID
        if ($request.enabled) { Enable-LocalUser -SID $sid } else { Disable-LocalUser -SID $sid }
        Write-Step "Cuenta $(if ($request.enabled) { 'habilitada' } else { 'deshabilitada' })."
        $games = @($request.games | Where-Object { $_ -and $_.folder })
        Write-Step "Juegos permitidos ($($games.Count)): $(($games | ForEach-Object { '{0} [{1}]' -f $_.name, $_.folder }) -join '; ')."
        # The child plays with the adult's library and its play, which writes in the game's folder (fix, language,
        # its log, a thaw) and in the library (its records and logs): the account may change both. Steam's own folders
        # are Steam's business.
        $writable = @(@($games | Where-Object { -not $_.steam } | ForEach-Object { ([string]$_.folder).TrimEnd('\') }) + @([string]$request.library) |
            Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -Unique)
        foreach ($folder in $writable) { Grant-Write $folder $sid }
        Write-Step "La cuenta puede escribir en ($($writable.Count)): $($writable -join '; ')."
        # A game that asks to run as administrator: the account is one (Windows asks the child to confirm, no password).
        $needsAdmin = @($games | Where-Object { $_.administrator } | ForEach-Object { [string]$_.name })
        $isAdmin = [bool](Get-LocalGroupMember -SID $AdminsGroupSid | Where-Object { $_.SID -eq $sid })
        if ($needsAdmin.Count -and -not $isAdmin) { Add-LocalGroupMember -SID $AdminsGroupSid -Member $sid; Write-Step "Cuenta de administrador: la piden $($needsAdmin -join ', ')." }
        elseif (-not $needsAdmin.Count -and $isAdmin) { Remove-LocalGroupMember -SID $AdminsGroupSid -Member $sid; Write-Step 'Ya no es administradora: ningún juego lo pide.' }
        Write-Family $request $sid $games
        Write-Step "Archivo de la familia escrito: $env:ProgramData\GameAccess\familia.json. Listo."
        exit 0
    } catch {
        $where = "línea $($_.InvocationInfo.ScriptLineNumber): $($_.InvocationInfo.Line.Trim())"
        Write-Step "ERROR: $($_.Exception.Message) ($where)"
        [IO.File]::WriteAllText("$FromFamily.error", "$($_.Exception.Message) ($where)")
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
