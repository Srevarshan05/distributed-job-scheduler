@echo off
:: start.bat
:: Windows Batch file to launch start.ps1.
:: Enables click-and-run execution on Windows without ExecutionPolicy restrictions.

cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "start.ps1"
if %errorlevel% neq 0 (
    echo.
    echo [ERROR] Script execution failed.
    pause
)
