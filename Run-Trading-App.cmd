@echo off
setlocal
cd /d "%~dp0"
powershell -ExecutionPolicy Bypass -File "%~dp0scripts\start-app.ps1" -OpenBrowser
if errorlevel 1 (
  echo.
  echo Startup failed.
)
pause
