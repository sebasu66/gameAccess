# Recover only orphaned, read-only Digital snapshots after the client closes.
$ErrorActionPreference = 'Stop'
$project = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$client = Join-Path $project 'GameAccess-latest.exe'
$runner = Join-Path $project 'apps\launcher\digital_process_runner.py'
$processes = @(Get-CimInstance Win32_Process)
$byId = @{}
foreach ($item in $processes) { $byId[[int]$item.ProcessId] = $item }
function Test-OrphanedSnapshot($item) {
    $parentId = [int]$item.ParentProcessId
    $visited = @{}
    while ($byId.ContainsKey($parentId)) {
        if ($visited.ContainsKey($parentId)) { return $false }
        $visited[$parentId] = $true
        $parent = $byId[$parentId]
        if ($parent.ExecutablePath -eq $client) { return $false }
        if ($parent.Name -notmatch '^python(w)?\.exe$' -or
            -not $parent.CommandLine -or -not $parent.CommandLine.Contains($runner)) { return $false }
        $parentId = [int]$parent.ParentProcessId
    }
    return $true
}
$orphans = @($processes | Where-Object {
    $_.Name -match '^python(w)?\.exe$' -and
    $_.CommandLine -and $_.CommandLine.Contains($runner) -and
    $_.CommandLine -match '--action\s+snapshot(?:\s|$)' -and
    (Test-OrphanedSnapshot $_)
})
foreach ($item in $orphans) { Stop-Process -Id $item.ProcessId -Force -ErrorAction SilentlyContinue }
[pscustomobject]@{ stoppedOrphanSnapshotProcesses=$orphans.Count } | ConvertTo-Json -Compress
