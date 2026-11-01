@echo off
chcp 65001 >nul
setlocal EnableExtensions
cd /d "%~dp0"
title Huaqiang Aetheon - Dependencies
set "PYTHONUTF8=1"
set "PYTHONIOENCODING=utf-8"

set "PS=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"
if not exist "%PS%" set "PS=powershell.exe"

if not exist "%~dp0下载依赖.ps1" (
  echo ERROR: 下载依赖.ps1 not found.
  pause
  exit /b 1
)

rem Windows PowerShell 5.1 reads UTF-8 without BOM as ANSI/GBK.
"%PS%" -NoLogo -NoProfile -Command "$p='%~dp0下载依赖.ps1'; $b=[IO.File]::ReadAllBytes($p); if($b.Length -lt 3 -or $b[0] -ne 0xEF -or $b[1] -ne 0xBB -or $b[2] -ne 0xBF){ Write-Host 'ERROR: 下载依赖.ps1 is not UTF-8 with BOM. Re-save it as UTF-8 with BOM.' -ForegroundColor Red; exit 2 }"
if errorlevel 2 (
  echo.
  echo Re-save 下载依赖.ps1 as UTF-8 with BOM, then run this file again.
  pause
  exit /b 1
)

"%PS%" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0下载依赖.ps1"
set "EXIT_CODE=%ERRORLEVEL%"

echo.
if not "%EXIT_CODE%"=="0" (
  echo Dependency setup failed. Exit code: %EXIT_CODE%
) else (
  echo Dependency setup completed.
)
pause
exit /b %EXIT_CODE%
