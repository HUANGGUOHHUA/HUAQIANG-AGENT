@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
title 华强以太 - 下载依赖

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0下载依赖.ps1"
set "EXIT_CODE=%ERRORLEVEL%"

echo.
if not "%EXIT_CODE%"=="0" (
  echo 依赖下载失败，退出码：%EXIT_CODE%
) else (
  echo 依赖下载完成。
)
pause
exit /b %EXIT_CODE%
