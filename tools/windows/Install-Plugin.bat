@echo off
REM ========================================================
REM Game Access Torrent Provider - Plugin Installer
REM ========================================================
setlocal
cd /d "%~dp0"

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-plugin.ps1"

