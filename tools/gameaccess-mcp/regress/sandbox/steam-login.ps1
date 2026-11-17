<#
  Inside Windows Sandbox: installs the Steam client if it is missing and signs in with the first test account that
  works, so Game Access can run games. Seba runs it (the sandbox's LogonCommand); nothing here prints or saves an
  account: the report says only "account N".

  -Accounts   CSV with the test accounts, copied into the shared folder for this pass and deleted at the end.
              Columns are found by name (user/login/account/usuario and pass/password/contraseña); a file with no
              header needs -Header, e.g. -Header user,password.
  -Setup      SteamSetup.exe, when Steam is not installed yet (installed silently with /S).
  -Report     JSON written at the end: { steam: "signed-in" | "failed", account, tried, problem }.

  The account goes to steam.exe on its command line (-login), the only way Steam takes it. Inside the sandbox only
  this session's processes can read it, and the sandbox is erased when it closes.
#>
param(
  [Parameter(Mandatory)] [string] $Accounts,
  [string] $Setup = "",
  [string] $Report = (Join-Path $PSScriptRoot "steam-login.json"),
  [string[]] $Header = @(),
  [int] $WaitSeconds = 240
)
$ErrorActionPreference = "Stop"
$steamExe = Join-Path ${env:ProgramFiles(x86)} "Steam\steam.exe"
$result = [ordered]@{ steam = "failed"; account = $null; tried = 0; problem = $null }

function Signed-In {
  try { return [int](Get-ItemProperty "HKCU:\Software\Valve\Steam\ActiveProcess" -ErrorAction Stop).ActiveUser -ne 0 } catch { return $false }
}
function Stop-Steam {
  Get-Process steam, steamwebhelper -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 3
}

try {
  if (-not (Test-Path $steamExe)) {
    if (-not $Setup -or -not (Test-Path $Setup)) { throw "Steam is not installed and no SteamSetup.exe was given." }
    Start-Process $Setup -ArgumentList "/S" -Wait
    if (-not (Test-Path $steamExe)) { throw "SteamSetup.exe /S did not install Steam." }
  }
  $rows = if ($Header.Count) { Import-Csv $Accounts -Header $Header } else { Import-Csv $Accounts }
  $names = @($rows | Select-Object -First 1 | ForEach-Object { $_.PSObject.Properties.Name })
  $userColumn = $names | Where-Object { $_ -match '^(user|username|login|account|usuario|cuenta)$' } | Select-Object -First 1
  $passColumn = $names | Where-Object { $_ -match '^(pass|password|pwd|contrase(n|ñ)a|clave)$' } | Select-Object -First 1
  if (-not $userColumn -or -not $passColumn) { throw "The accounts file has no user and password columns by name: pass -Header." }

  $index = 0
  foreach ($row in $rows) {
    $index += 1
    $result.tried = $index
    Stop-Steam
    Start-Process $steamExe -ArgumentList @("-silent", "-login", $row.$userColumn, $row.$passColumn)
    $deadline = (Get-Date).AddSeconds($WaitSeconds)
    while ((Get-Date) -lt $deadline -and -not (Signed-In)) { Start-Sleep -Seconds 3 }
    if (Signed-In) { $result.steam = "signed-in"; $result.account = $index; break }
    Write-Output "account $index failed"
  }
  if ($result.steam -ne "signed-in") { $result.problem = "no account signed in ($index tried)" }
} catch {
  $result.problem = $_.Exception.Message
} finally {
  $rows = $null
  # The copy of the accounts lives only for this pass.
  if (Test-Path $Accounts) { Remove-Item $Accounts -Force -ErrorAction SilentlyContinue }
  $result | ConvertTo-Json | Set-Content -Path $Report -Encoding utf8
  Write-Output "steam: $($result.steam)$(if ($result.account) { " (account $($result.account))" })$(if ($result.problem) { " - $($result.problem)" })"
}
