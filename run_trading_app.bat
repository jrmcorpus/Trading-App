@echo off
setlocal

cd /d "%~dp0"

echo ==========================================
echo Trading App One-Click Launcher
echo ==========================================
echo.

where npm >nul 2>nul
if errorlevel 1 (
  echo [ERROR] npm is not installed or not in PATH.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo [INFO] Installing dependencies...
  call npm install
  if errorlevel 1 (
    echo [ERROR] npm install failed.
    pause
    exit /b 1
  )
)

echo [INFO] Starting MT4 bridge...
start "Trading App - Bridge" cmd /k "cd /d %~dp0 && npm run market-bridge"

echo [INFO] Starting frontend...
start "Trading App - Frontend" cmd /k "cd /d %~dp0 && npm run dev"

echo [INFO] Opening app in browser...
timeout /t 3 /nobreak >nul
start "" "http://localhost:3000"

echo.
echo [DONE] Bridge and frontend started.
echo Close this window anytime. App will keep running in the two opened terminals.
pause

