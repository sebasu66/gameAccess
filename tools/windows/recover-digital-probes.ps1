# Close the previous client before deploying a corrected executable, and remove
# only its read-only Digital status snapshots. Downloads and games are untouched.
$ErrorActionPreference = 'Stop'
$project = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$client = Join-Path $project 'GameAccess-latest.exe'
$runner = Join-Path $project 'apps\launcher\digital_process_runner.py'
$processes = @(Get-CimInstance Win32_Process)
$clients = @($processes | Where-Object { $_.ExecutablePath -eq $client })
foreach ($item in $clients) { Stop-Process -Id $item.ProcessId -Force -ErrorAction SilentlyContinue }
$probes = @($processes | Where-Object {
    $_.Name -match '^python(w)?\.exe$' -and
    $_.CommandLine -and $_.CommandLine.Contains($runner) -and
    $_.CommandLine -match '--action\s+snapshot(?:\s|$)'
})
foreach ($item in $probes) { Stop-Process -Id $item.ProcessId -Force -ErrorAction SilentlyContinue }
[pscustomobject]@{ closedClients=$clients.Count; stoppedSnapshotProcesses=$probes.Count } | ConvertTo-Json -Compress
