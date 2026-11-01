@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
title Huaqiang Aetheon - Dependencies

"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0下载依赖.ps1"
set "EXIT_CODE=%ERRORLEVEL%"

echo.
if not "%EXIT_CODE%"=="0" (
  echo Dependency setup failed. Exit code: %EXIT_CODE%
) else (
  echo Dependency setup completed.
)
pause
exit /b %EXIT_CODE%
