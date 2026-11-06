@echo off
REM ========================================================
REM Game Access - Run Local API Server
REM ========================================================
setlocal

cd /d "%~dp0apps\api"
set PYTHONPATH=.
set PYTHONUNBUFFERED=1

echo ========================================================
echo Starting Game Access Local API Server on http://127.0.0.1:38147
echo Press Ctrl+C to stop.
echo ========================================================

".venv\Scripts\python.exe" -m uvicorn app.main:app --host 127.0.0.1 --port 38147 --reload
