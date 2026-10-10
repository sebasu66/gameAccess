[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][string]$PluginDirectory,
    [Parameter(Mandatory=$true)][string]$Executable,
    [Parameter(Mandatory=$true)][string]$UserDataDirectory,
    [Parameter(Mandatory=$true)][int]$SelfPid,
    [ValidateSet('Inspect','Terminate')][string]$Mode = 'Inspect',
    [int]$CandidatePid = 0,
    [string]$ExpectedCreationTicks = '',
    [switch]$Packaged
)
$ErrorActionPreference = 'Stop'
$pluginRoot = [IO.Path]::GetFullPath($PluginDirectory).TrimEnd('\')
$expectedExe = [IO.Path]::GetFullPath($Executable)
$userDirectory = [IO.Path]::GetFullPath($UserDataDirectory).TrimEnd('\').ToLowerInvariant()
$all = @(Get-CimInstance Win32_Process)
$byId = @{}
foreach ($entry in $all) { $byId[[int]$entry.ProcessId] = $entry }
$listeners = @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue)
function Test-Identity($entry) {
    if (-not $entry -or $entry.ProcessId -eq $SelfPid -or $entry.ExecutablePath -ne $expectedExe) { return $false }
    $command = ([string]$entry.CommandLine).Replace('/','\')
    if ($command -match '--type=') {
        $lower = $command.ToLowerInvariant()
        return $lower.Contains('--user-data-dir="' + $userDirectory + '"') -or $lower.Contains('--user-data-dir=' + $userDirectory + ' ')
    }
    if ($Packaged) { return $true }
    $rootPattern = '(?:^|\s)"?' + [regex]::Escape($pluginRoot) + '"?(?:\s|$)'
    if ($command -match $rootPattern) { return $true }
    if ($command -notmatch '(?:^|\s)"?\."?(?:\s|$)') { return $false }
    # A dot launch alone does not identify its working directory. Require a
    # renderer child that identifies this exact app path before touching it.
    $childPattern = '--app-path="?'+ [regex]::Escape($pluginRoot) + '"?(?:\s|$)'
    return [bool]($all | Where-Object {
        $_.ParentProcessId -eq $entry.ProcessId -and $_.ExecutablePath -eq $expectedExe -and
        $_.CreationDate -ge $entry.CreationDate -and ([string]$_.CommandLine).Replace('/','\') -match $childPattern
    } | Select-Object -First 1)
}
function Get-Record($entry) {
    $child = ([string]$entry.CommandLine) -match '--type='
    $created = $entry.CreationDate.ToUniversalTime()
    $age = ([DateTime]::UtcNow - $created).TotalSeconds
    $parent = $byId[[int]$entry.ParentProcessId]
    $parentMissing = -not $parent -or $parent.ExecutablePath -ne $expectedExe -or $parent.CreationDate.ToUniversalTime() -gt $created
    $process = Get-Process -Id $entry.ProcessId -ErrorAction SilentlyContinue
    $ports = @($listeners | Where-Object OwningProcess -eq $entry.ProcessId | Select-Object -ExpandProperty LocalPort)
    return [pscustomobject]@{
        pid = [int]$entry.ProcessId; kind = $(if ($child) {'child'} else {'main'})
        creationTicks = [string]$created.Ticks; ageSeconds = [int]$age
        parentMissing = [bool]$parentMissing; hasWindow = [bool]($process -and $process.MainWindowHandle -ne 0)
        responding = [bool]($process -and $process.Responding); ports = $ports
    }
}
function Test-Orphan($record) {
    if ($record.kind -eq 'child') { return $record.parentMissing }
    return $record.ageSeconds -ge 15 -and (-not $record.hasWindow -or $record.ports.Count -eq 0 -or ($record.ageSeconds -ge 30 -and -not $record.responding))
}
$matches = @($all | Where-Object { Test-Identity $_ })
if ($Mode -eq 'Inspect') {
    $records = @($matches | ForEach-Object { Get-Record $_ })
    ConvertTo-Json -InputObject $records -Depth 4 -Compress
    exit 0
}
$candidate = $byId[$CandidatePid]
if (-not (Test-Identity $candidate)) { '{"skipped":"identity no longer matches"}'; exit 0 }
$record = Get-Record $candidate
if ($record.creationTicks -ne $ExpectedCreationTicks -or -not (Test-Orphan $record)) {
    '{"skipped":"process changed or is no longer orphaned"}'; exit 0
}
$targets = @($candidate)
if ($record.kind -eq 'main') {
    $ids = @{}; $ids[$CandidatePid] = $true
    do {
        $added = $false
        foreach ($entry in $matches) {
            if (-not $ids.ContainsKey([int]$entry.ProcessId) -and $ids.ContainsKey([int]$entry.ParentProcessId) -and $entry.CreationDate -ge $candidate.CreationDate) {
                $ids[[int]$entry.ProcessId] = $true; $targets += $entry; $added = $true
            }
        }
    } while ($added)
}
$stopped = @()
foreach ($entry in ($targets | Sort-Object CreationDate -Descending)) {
    $live = Get-CimInstance Win32_Process -Filter "ProcessId=$($entry.ProcessId)"
    if ((Test-Identity $live) -and $live.CreationDate -eq $entry.CreationDate) {
        Stop-Process -Id $entry.ProcessId -ErrorAction Stop
        $stopped += [int]$entry.ProcessId
    }
}
ConvertTo-Json -InputObject @{ stopped = $stopped } -Compress
