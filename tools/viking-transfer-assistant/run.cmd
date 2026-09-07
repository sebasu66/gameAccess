@echo off
setlocal
cd /d "%~dp0\..\.."

set "PROBE=tools\viking-webview-probe\target\release\viking-webview-probe.exe"
if not exist "%PROBE%" (
  echo [assistant] Building ViKiNG WebView downloader...
  cargo build --manifest-path tools\viking-webview-probe\Cargo.toml --release
  if errorlevel 1 exit /b %errorlevel%
)

echo [assistant] Starting GameAccess Torrent ^<^> ViKiNG test assistant...
python tools\viking-transfer-assistant\app.py
