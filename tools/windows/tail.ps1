[CmdletBinding()]
param(
    [Parameter(Mandatory = $true, Position = 0)]
    [string]$Path,

    [ValidateRange(1, 100000)]
    [int]$Lines = 50,

    [switch]$FromStart
)

$ErrorActionPreference = 'Stop'

$resolved = Resolve-Path -LiteralPath $Path -ErrorAction Stop
$item = Get-Item -LiteralPath $resolved -ErrorAction Stop
if ($item.PSIsContainer) {
    throw "Tail expects a file, but '$resolved' is a directory."
}

Write-Host "Following: $resolved"
Write-Host "Press Ctrl+C to stop."
Write-Host ""

if ($FromStart) {
    Get-Content -LiteralPath $resolved -Wait
} else {
    Get-Content -LiteralPath $resolved -Tail $Lines -Wait
}
