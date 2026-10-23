[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$configPath = Join-Path $root 'apps/api/courtesy-keys.json'
if (!(Test-Path -LiteralPath $configPath)) { throw 'No local private developer-key configuration found.' }
$config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
$developerEntries = @($config.keys | Where-Object { $_.name -ceq 'developer' })
if ($developerEntries.Count -ne 1) { throw 'Expected exactly one developer entry; configuration preserved.' }
if ($developerEntries[0].access_tier -ne 'plus') {
    $backup = $configPath + '.pre-plus-' + (Get-Date -Format 'yyyyMMdd-HHmmss')
    Copy-Item -LiteralPath $configPath -Destination $backup
    $developerEntries[0] | Add-Member -NotePropertyName access_tier -NotePropertyValue plus -Force
    $temporary = $configPath + '.tmp'
    [System.IO.File]::WriteAllText($temporary, ($config | ConvertTo-Json -Depth 20), [System.Text.UTF8Encoding]::new($false))
    Move-Item -LiteralPath $temporary -Destination $configPath -Force
}
@{ key_name = 'developer'; access_tier = 'plus'; credentials_disclosed = $false } | ConvertTo-Json -Compress
