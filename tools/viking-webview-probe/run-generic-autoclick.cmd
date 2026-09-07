@echo off
setlocal
set "ROOT=C:\DEV\gameAccess-viking-webview-probe"
set "PROBE=%ROOT%\tools\viking-webview-probe\target\release\viking-webview-probe.exe"
set "REPORT=%ROOT%\viking-generic-autoclick-report.json"
set "OUTPUT=%ROOT%\gameaccess-test-autoclick.zip"

if not exist "%PROBE%" (
  echo [runner] probe executable not found: %PROBE%
  exit /b 2
)

if exist "%REPORT%" del /q "%REPORT%"
if exist "%OUTPUT%" del /q "%OUTPUT%"

echo [runner] starting ViKiNG generic ZIP automatic flow
"%PROBE%" --url "https://vikingfile.com/f/XufZfb2DZt" --timeout 180 --report "%REPORT%" --download "%OUTPUT%"
set "RC=%ERRORLEVEL%"
echo [runner] probe exit code=%RC%
if exist "%REPORT%" echo [runner] report=%REPORT%
if exist "%OUTPUT%" for %%F in ("%OUTPUT%") do echo [runner] output=%%~fF bytes=%%~zF
exit /b %RC%
