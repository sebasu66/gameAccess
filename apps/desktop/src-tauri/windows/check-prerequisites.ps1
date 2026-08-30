$ErrorActionPreference = "Stop"
function Find-SteamRoot {
  $registry=@(@{Path="HKCU:\Software\Valve\Steam";Name="SteamPath"},@{Path="HKLM:\SOFTWARE\WOW6432Node\Valve\Steam";Name="InstallPath"},@{Path="HKLM:\SOFTWARE\Valve\Steam";Name="InstallPath"})
  foreach($entry in $registry){try{$value=(Get-ItemProperty -Path $entry.Path -Name $entry.Name -ErrorAction Stop).($entry.Name);if($value -and (Test-Path (Join-Path $value "steam.exe"))){return $value}}catch{}}
  foreach($candidate in @("${env:ProgramFiles(x86)}\Steam","$env:ProgramFiles\Steam","C:\Steam")){if($candidate -and (Test-Path (Join-Path $candidate "steam.exe"))){return $candidate}}
  return $null
}
$steam=Find-SteamRoot
if(-not $steam){Write-Output "STEAM_MISSING";exit 20}
$loginUsers=Join-Path $steam "config\loginusers.vdf"
if(-not(Test-Path $loginUsers)){Write-Output "ACCOUNTS_MISSING";exit 30}
$text=Get-Content -Path $loginUsers -Raw -ErrorAction Stop
$remembered=[regex]::Matches($text,'"RememberPassword"\s*"1"',[System.Text.RegularExpressions.RegexOptions]::IgnoreCase).Count
if($remembered -lt 1){Write-Output "ACCOUNTS_MISSING";exit 30}
Write-Output "OK|$steam|$remembered"
exit 0
