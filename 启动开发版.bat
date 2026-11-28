@echo off
setlocal
cd /d "%~dp0"
rem Never let an inherited ELECTRON_RUN_AS_NODE turn Electron into plain Node.
set "ELECTRON_RUN_AS_NODE="

if /i "%~1"=="--check" (
  echo launcher-check-ok
  exit /b 0
)
if /i "%~1"=="--console" goto :console
if /i "%~1"=="--hidden" goto :run

start "" /b wscript.exe "%~dp0dev-hidden.vbs" %*
exit /b 0

:console
shift

:run
title Huaqiang Agent Dev

set "HQ_HIDDEN="
set "HQ_CHECK="
if /i "%~1"=="--hidden" set "HQ_HIDDEN=1"
if /i "%~1"=="--check" set "HQ_CHECK=1"
if /i "%~2"=="--check" set "HQ_CHECK=1"
if defined HQ_CHECK (
  echo launcher-check-ok
  exit /b 0
)

echo ==========================================
echo   Huaqiang Agent - Development Launcher
echo ==========================================
echo.

whoami /groups 2>nul | findstr /i "S-1-16-4096" >nul
if not errorlevel 1 (
  echo [WARN] This process is running at Low Mandatory Level.
  echo        File writes will fail even with Full Control ACLs.
  echo        Launch this file from Explorer or a normal terminal.
  echo.
)

net session >nul 2>&1
if not errorlevel 1 (
  echo [WARN] Running with administrator rights.
  echo        Windows blocks dragging files from Explorer into elevated windows.
  echo        Start this launcher normally ^(without admin^) to enable drag and drop.
  echo.
)

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js was not found in PATH.
  if not defined HQ_HIDDEN pause
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo [ERROR] npm was not found in PATH.
  if not defined HQ_HIDDEN pause
  exit /b 1
)

if not exist "node_modules\electron\dist\electron.exe" (
  echo [SETUP] Dependencies are missing. Running npm install...
  call npm.cmd install --no-audit --no-fund
  if errorlevel 1 (
    echo.
    echo [ERROR] npm install failed. See the output above.
    if not defined HQ_HIDDEN pause
    exit /b 1
  )
)

echo [START] npm run dev
echo [INFO] Closing this window stops the dev server.
echo.
call npm.cmd run dev

set "EXIT_CODE=%ERRORLEVEL%"
if not "%EXIT_CODE%"=="0" (
  echo.
  echo [EXIT] Dev server stopped with code %EXIT_CODE%.
  if not defined HQ_HIDDEN pause
)
exit /b %EXIT_CODE%
