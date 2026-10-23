[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$sourceUnpacked = 'C:\DEV\ga-torrent-plugin\dist\win-unpacked'
$sevenZip = 'C:\Program Files\7-Zip\7z.exe'

if (-not (Test-Path -LiteralPath $sourceUnpacked)) {
    throw "Source unpacked plugin directory not found at $sourceUnpacked"
}

Write-Host "Creating self-contained plugin payload archive..." -ForegroundColor Cyan
$payloadZip = Join-Path $root 'tools/plugin-installer/plugin-payload.zip'

if (Test-Path -LiteralPath $sevenZip) {
    & $sevenZip a -tzip -mx5 "$payloadZip" "$sourceUnpacked\*" -y | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "7-Zip failed with exit code $LASTEXITCODE" }
} else {
    Compress-Archive -Path "$sourceUnpacked\*" -DestinationPath "$payloadZip" -CompressionLevel Optimal -Force
}

$payloadCopy = Join-Path $root 'tools/windows/plugin-payload.zip'
Copy-Item -LiteralPath $payloadZip -Destination $payloadCopy -Force

Write-Host "Compiling standalone GameAccess Plugin Installer (.exe)..." -ForegroundColor Cyan
$csproj = Join-Path $root 'tools/plugin-installer/GameAccessPluginInstaller.csproj'
$outputDir = Join-Path $root 'tools/windows/dist-installer'

& dotnet publish "$csproj" -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -o "$outputDir"
if ($LASTEXITCODE -ne 0) { throw "Dotnet publish failed with exit code $LASTEXITCODE" }

$installerExe = Join-Path $outputDir 'GameAccessPluginInstaller.exe'
$finalExe = Join-Path $root 'tools/windows/GameAccess-Plugin-Installer.exe'
Copy-Item -LiteralPath $installerExe -Destination $finalExe -Force

$hash = (Get-FileHash -LiteralPath $finalExe -Algorithm SHA256).Hash
$sizeMb = [math]::Round((Get-Item -LiteralPath $finalExe).Length / 1MB, 2)

Write-Host "Installer created successfully:" -ForegroundColor Green
Write-Host "File: $finalExe"
Write-Host "Size: $sizeMb MB"
Write-Host "SHA256: $hash"

@{
    installer = $finalExe
    size_mb = $sizeMb
    sha256 = $hash
    built_at_utc = [DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ssZ')
} | ConvertTo-Json -Compress
