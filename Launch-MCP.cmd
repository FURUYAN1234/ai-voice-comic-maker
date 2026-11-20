@echo off
setlocal
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0mcp\launcher.ps1" %*
set "furu_exit=%errorlevel%"
if not "%furu_exit%"=="0" pause
exit /b %furu_exit%
