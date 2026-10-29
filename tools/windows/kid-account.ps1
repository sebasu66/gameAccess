<#
.SYNOPSIS
Kid mode proof of concept (vault/Modo niño.md, task MN.2): a standard local Windows account for a child, with Game
Access as its desktop, Task Manager off, logon hours, and the game folders unable to run for kids until a game is
allowed.

.DESCRIPTION
Run it from PowerShell opened as administrator. It can be run again: an existing account is kept and its settings
are applied again.

- Creates the account (standard user, password asked unless -NoPassword) and its profile, so its settings can be
  written before the first sign-in.
- Puts it in the local group GameAccess-Kids.
- In that account: Game Access replaces the Windows desktop (Winlogon Shell) and Task Manager is disabled.
- Logon hours (-Weekdays / -Weekend, local hours "from-to"); Windows itself keeps the child out of them.
- In each game folder (by default the one chosen in the installer, HKLM\Software\gameAccess\GamesDir) the group may
  not run anything (.exe or .dll). -Allow lets one game folder run for this account, as the SYSTEM service will do
  (MN.6); -Disallow takes it back.
- -Remove deletes the account, its profile and the permissions this script added.

.EXAMPLE
powershell -ExecutionPolicy Bypass -File tools\windows\kid-account.ps1 -Name Prueba -Weekdays 16-20 -Weekend 10-21

.EXAMPLE
powershell -ExecutionPolicy Bypass -File tools\windows\kid-account.ps1 -Name Prueba -Allow "C:\juegos_GameAccess\413150-Stardew Valley-ready"

.EXAMPLE
powershell -ExecutionPolicy Bypass -File tools\windows\kid-account.ps1 -Name Prueba -Remove
#>
[CmdletBinding(SupportsShouldProcess, ConfirmImpact = 'Medium', DefaultParameterSetName = 'Create')]
param(
    [Parameter(Mandatory)][ValidatePattern('^[A-Za-z0-9._-]{1,20}$')][string]$Name,
    [Parameter(ParameterSetName = 'Create')][string]$FullName,
    [Parameter(ParameterSetName = 'Create')][switch]$NoPassword,
    [Parameter(ParameterSetName = 'Create')][ValidatePattern('^\d{1,2}-\d{1,2}$')][string]$Weekdays,
    [Parameter(ParameterSetName = 'Create')][ValidatePattern('^\d{1,2}-\d{1,2}$')][string]$Weekend,
    [Parameter(ParameterSetName = 'Create')][Parameter(ParameterSetName = 'Remove')][string[]]$GameFolders,
    [Parameter(ParameterSetName = 'Create')][string]$Shell = (Join-Path $env:ProgramFiles 'gameAccess\gameaccess-desktop.exe'),
    [Parameter(ParameterSetName = 'Allow', Mandatory)][string]$Allow,
    [Parameter(ParameterSetName = 'Disallow', Mandatory)][string]$Disallow,
    [Parameter(ParameterSetName = 'Remove', Mandatory)][switch]$Remove
)
$ErrorActionPreference = 'Stop'

$Group = 'GameAccess-Kids'
$UsersGroupSid = 'S-1-5-32-545'  # "Users" / "Usuarios", by SID so any Windows language works

$principal = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Hace falta PowerShell abierto como administrador.'
}

# The folders the game folders' rule goes on: the ones given, or the installer's choice.
function Get-GameFolders {
    if ($GameFolders) { return $GameFolders }
    $chosen = (Get-ItemProperty -LiteralPath 'HKLM:\SOFTWARE\gameAccess' -ErrorAction SilentlyContinue).GamesDir
    if ($chosen) { return @($chosen) }
    Write-Warning 'No hay carpeta de juegos en HKLM\Software\gameAccess (GamesDir): pasala con -GameFolders.'
    return @()
}

# Adds or removes one access rule on a folder (only its access list: owner and auditing are left alone).
function Set-FolderRule([string]$Folder, [Security.Principal.SecurityIdentifier]$Sid, [string]$Kind, [switch]$Drop) {
    $dir = Get-Item -LiteralPath $Folder
    $acl = $dir.GetAccessControl('Access')
    $rule = New-Object Security.AccessControl.FileSystemAccessRule($Sid, 'ExecuteFile', 'ContainerInherit,ObjectInherit', 'None', $Kind)
    if ($Drop) { [void]$acl.RemoveAccessRule($rule) } else { $acl.AddAccessRule($rule) }
    # Windows passes the change down to every file inside: a big game folder can take a while.
    $dir.SetAccessControl($acl)
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
function Use-KidRegistry([Security.Principal.SecurityIdentifier]$Sid, [string]$ProfilePath, [scriptblock]$Write) {
    $live = "Registry::HKEY_USERS\$($Sid.Value)"
    if (Test-Path -LiteralPath $live) { & $Write $live; return }
    $mount = "GameAccess-$Name"
    & reg.exe load "HKU\$mount" (Join-Path $ProfilePath 'NTUSER.DAT') | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "No se pudo abrir el registro de $Name." }
    try { & $Write "Registry::HKEY_USERS\$mount" }
    finally {
        # The registry provider keeps handles until they are collected; unloading fails while they are open.
        [GC]::Collect(); [GC]::WaitForPendingFinalizers(); Start-Sleep -Milliseconds 500
        & reg.exe unload "HKU\$mount" | Out-Null
        if ($LASTEXITCODE -ne 0) { Write-Warning "El registro de $Name quedó abierto como HKU\$mount; se cierra al reiniciar." }
    }
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
        if ($PSCmdlet.ShouldProcess($Allow, "Dejar que $Name ejecute")) { Set-FolderRule $Allow (Get-KidSid) 'Allow' }
        Write-Host "$Name puede ejecutar lo que hay en $Allow."
        return
    }
    'Disallow' {
        if ($PSCmdlet.ShouldProcess($Disallow, "Quitarle a $Name el permiso de ejecutar")) { Set-FolderRule $Disallow (Get-KidSid) 'Allow' -Drop }
        Write-Host "$Name ya no puede ejecutar lo que hay en $Disallow."
        return
    }
    'Remove' {
        $sid = Get-KidSid
        if (-not $PSCmdlet.ShouldProcess($Name, 'Borrar la cuenta, su perfil y sus permisos')) { return }
        $groupSid = (Get-LocalGroup -Name $Group -ErrorAction SilentlyContinue).SID
        $others = if ($groupSid) { @(Get-LocalGroupMember -SID $groupSid | Where-Object { $_.SID -ne $sid }) } else { @() }
        foreach ($folder in Get-GameFolders) {
            if (-not (Test-Path -LiteralPath $folder)) { continue }
            $dir = Get-Item -LiteralPath $folder
            $acl = $dir.GetAccessControl('Access')
            $acl.PurgeAccessRules($sid)
            if ($groupSid -and $others.Count -eq 0) { $acl.PurgeAccessRules($groupSid) }
            $dir.SetAccessControl($acl)
        }
        # Folders allowed with -Allow deeper inside keep a rule for an account that no longer exists: harmless.
        Get-CimInstance Win32_UserProfile -Filter "SID='$($sid.Value)'" | Remove-CimInstance
        Remove-LocalUser -SID $sid
        if ($groupSid -and $others.Count -eq 0) { Remove-LocalGroup -SID $groupSid }
        Write-Host "Cuenta $Name borrada."
        return
    }
}

# Create (or apply again).
if (-not (Test-Path -LiteralPath $Shell)) { Write-Warning "No está ${Shell}: instalá Game Access para toda la PC o pasá -Shell." }
if (-not $PSCmdlet.ShouldProcess($Name, 'Crear o actualizar la cuenta de niño')) { return }

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

if (-not (Get-LocalGroupMember -SID $UsersGroupSid | Where-Object { $_.SID -eq $sid })) { Add-LocalGroupMember -SID $UsersGroupSid -Member $sid }
$kids = Get-LocalGroup -Name $Group -ErrorAction SilentlyContinue
if (-not $kids) { $kids = New-LocalGroup -Name $Group -Description 'Cuentas de niño de Game Access: no ejecutan juegos que Game Access no habilitó' }
if (-not (Get-LocalGroupMember -SID $kids.SID | Where-Object { $_.SID -eq $sid })) { Add-LocalGroupMember -SID $kids.SID -Member $sid }

$profilePath = Get-KidProfile $sid
Use-KidRegistry $sid $profilePath {
    param($hkcu)
    $winlogon = "$hkcu\Software\Microsoft\Windows NT\CurrentVersion\Winlogon"
    $system = "$hkcu\Software\Microsoft\Windows\CurrentVersion\Policies\System"
    foreach ($key in $winlogon, $system) { if (-not (Test-Path -LiteralPath $key)) { New-Item -Path $key -Force | Out-Null } }
    # Quoted: the path has spaces.
    New-ItemProperty -LiteralPath $winlogon -Name Shell -Value ('"{0}"' -f $Shell) -PropertyType String -Force | Out-Null
    New-ItemProperty -LiteralPath $system -Name DisableTaskMgr -Value 1 -PropertyType DWord -Force | Out-Null
}
Write-Host "Escritorio de ${Name}: $Shell. Administrador de tareas deshabilitado."

Set-LogonHours

foreach ($folder in Get-GameFolders) {
    if (-not (Test-Path -LiteralPath $folder)) { Write-Warning "No existe $folder."; continue }
    Write-Host "Bloqueando la ejecución para $Group en $folder (puede tardar)..."
    Set-FolderRule $folder $kids.SID 'Deny'
}

Write-Host ''
& net.exe user $Name | Select-String -Pattern '^(Logon hours|Horas de inicio|Local Group|Miembros del grupo local)' -Context 0, 6
Write-Host ''
Write-Host 'Para probar: cerrá sesión y entrá como el niño. Habilitá un juego con -Allow "<carpeta del juego>".'
Write-Host 'Si la pantalla queda en negro al cerrar Game Access: Ctrl+Alt+Supr -> Cerrar sesión.'
