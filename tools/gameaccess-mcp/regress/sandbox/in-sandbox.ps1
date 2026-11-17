<#
  Runs inside Windows Sandbox when gameaccess.wsb opens it (make-kit.mjs builds C:\GA). On a clean Windows:
    1. installs Game Access from the test installer, silently, as a user would get it;
    2. installs Steam and signs in with the first test account that works (steam-login.ps1);
    3. installs the source plugin from its page's link (gameaccess://install-plugin...), answering "Yes" to the app's
       question, the way the page's button does it;
    4. runs the regression pass with the game cycle and no key (base access);
    5. with secret\plus-key.txt, loads that key and runs the cycle again (PLUS).
  Everything goes to C:\GA\out: sandbox.log, steam-login.json, plugin.json and runs\<date> for each pass.
  secret\ (accounts, key, link) is deleted at the end, whatever happened.
#>
$ErrorActionPreference = "Continue"
$kit = "C:\GA"
$out = Join-Path $kit "out"
$secret = Join-Path $kit "secret"
$node = Join-Path $kit "node\node.exe"
$runner = Join-Path $kit "mcp\regress\run.mjs"
New-Item -ItemType Directory -Force $out | Out-Null
Start-Transcript -Path (Join-Path $out "sandbox.log") -Append | Out-Null

function Find-App {
  foreach ($root in @($env:ProgramFiles, ${env:ProgramFiles(x86)}, (Join-Path $env:LOCALAPPDATA "Programs"))) {
    $found = Get-ChildItem $root -Recurse -Filter "gameaccess-desktop.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($found) { return $found.FullName }
  }
  return $null
}

# Answers "Yes" to Game Access's plugin question (a Win32 message box: the Yes button's id is 6 in any language).
function Confirm-PluginBox([int] $seconds) {
  Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
  $root = [System.Windows.Automation.AutomationElement]::RootElement
  $byTitle = New-Object System.Windows.Automation.PropertyCondition ([System.Windows.Automation.AutomationElement]::NameProperty), "Game Access - instalar plugin"
  $yes = New-Object System.Windows.Automation.PropertyCondition ([System.Windows.Automation.AutomationElement]::AutomationIdProperty), "6"
  $deadline = (Get-Date).AddSeconds($seconds)
  while ((Get-Date) -lt $deadline) {
    $box = $root.FindFirst([System.Windows.Automation.TreeScope]::Children, $byTitle)
    if ($box) {
      $button = $box.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $yes)
      if ($button) { $button.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke(); return $true }
    }
    Start-Sleep -Milliseconds 500
  }
  return $false
}

try {
  # 1. Game Access
  Write-Output "installing Game Access"
  Start-Process (Join-Path $kit "app\gameaccess-setup.exe") -ArgumentList "/S" -Wait
  $app = Find-App
  if (-not $app) { throw "the installer left no gameaccess-desktop.exe" }
  Write-Output "installed: $app"

  # 2. Steam
  $setup = Join-Path $kit "app\SteamSetup.exe"
  if (-not (Test-Path $setup)) {
    $setup = Join-Path $env:TEMP "SteamSetup.exe"
    Invoke-WebRequest "https://cdn.akamai.steamstatic.com/client/installer/SteamSetup.exe" -OutFile $setup -UseBasicParsing
  }
  $accounts = Join-Path $secret "accounts.csv"
  if (Test-Path $accounts) {
    & (Join-Path $kit "mcp\regress\sandbox\steam-login.ps1") -Accounts $accounts -Setup $setup -Report (Join-Path $out "steam-login.json")
  } else {
    Start-Process $setup -ArgumentList "/S" -Wait
    Write-Output "steam: no accounts in the kit, not signed in"
  }

  # 3. Source plugin, from its page's link
  $link = Join-Path $secret "plugin-link.txt"
  $plugin = [ordered]@{ installed = $false; problem = $null }
  if (Test-Path $link) {
    $plugins = Join-Path $env:APPDATA "GameAccess\plugins"
    $before = @(Get-ChildItem $plugins -Directory -ErrorAction SilentlyContinue).Count
    $process = Start-Process $app -ArgumentList @((Get-Content $link -TotalCount 1).Trim()) -PassThru
    if (-not (Confirm-PluginBox 120)) { $plugin.problem = "the app did not ask to install the plugin within 2 minutes" }
    else {
      $deadline = (Get-Date).AddMinutes(10)
      while ((Get-Date) -lt $deadline -and @(Get-ChildItem $plugins -Directory -ErrorAction SilentlyContinue).Count -le $before) { Start-Sleep -Seconds 3 }
      $plugin.installed = @(Get-ChildItem $plugins -Directory -ErrorAction SilentlyContinue).Count -gt $before
      if (-not $plugin.installed) { $plugin.problem = "no plugin folder appeared in $plugins within 10 minutes" }
    }
    Start-Sleep -Seconds 5
    Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
    Get-Process gameaccess-desktop -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  } else { $plugin.problem = "no plugin-link.txt in the kit" }
  $plugin | ConvertTo-Json | Set-Content (Join-Path $out "plugin.json") -Encoding utf8
  Write-Output "plugin: $(if ($plugin.installed) { 'installed' } else { $plugin.problem })"

  # 4 and 5. The passes
  $env:GA_RUNS = Join-Path $out "runs"
  Write-Output "pass without a key"
  & $node $runner --installed $app --cycle
  $key = Join-Path $secret "plus-key.txt"
  if (Test-Path $key) {
    Write-Output "pass with a PLUS key"
    & $node $runner --installed $app --only cycle --activate $key
  } else { Write-Output "no plus-key.txt in the kit: PLUS pass skipped" }
} catch {
  Write-Output "sandbox pass stopped: $($_.Exception.Message)"
} finally {
  Remove-Item $secret -Recurse -Force -ErrorAction SilentlyContinue
  Set-Content (Join-Path $out "done.txt") (Get-Date -Format o)
  Stop-Transcript | Out-Null
}
