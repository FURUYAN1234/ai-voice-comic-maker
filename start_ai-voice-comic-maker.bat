@echo off
setlocal
cd /d "%~dp0"

echo ============================================
echo   AI Voice Comic Maker - Starting...
echo ============================================

where node >nul 2>nul
if errorlevel 1 goto NODE_MISSING

where npm >nul 2>nul
if errorlevel 1 goto NPM_MISSING

if not exist node_modules (
    echo [INFO] node_modules not found. Installing dependencies...
    call npm install
)

if not exist node_modules goto INSTALL_ERROR

REM --- VOICEVOX Engine Check ---
echo [INFO] Checking VOICEVOX Engine on localhost:50021...
curl -s -o nul -w "%%{http_code}" http://127.0.0.1:50021/version > "%TEMP%\voicevox_check.txt" 2>nul
set /p VVSTATUS=<"%TEMP%\voicevox_check.txt"
del "%TEMP%\voicevox_check.txt" 2>nul

if "%VVSTATUS%"=="200" (
    echo [OK] VOICEVOX Engine is running.
) else (
    echo [WARN] VOICEVOX Engine is NOT running on port 50021.
    echo [WARN] Please start VOICEVOX manually before using voice synthesis.
    echo [WARN] Download: https://voicevox.hiroshiba.jp/
    echo.
)

REM --- Remotion Dependencies Check ---
if not exist "node_modules\@remotion\cli" (
    echo [INFO] Remotion packages not found. Installing...
    call npm install
)

if not exist "node_modules\@remotion\cli" goto INSTALL_ERROR

echo [INFO] Launching frontend + backend server...
start "" "http://localhost:5173"
call npm run dev

if errorlevel 1 goto RUN_ERROR

pause
exit /b

:NODE_MISSING
echo [ERROR] Node.js is not installed.
echo Please install Node.js from https://nodejs.org/
pause
exit /b

:NPM_MISSING
echo [ERROR] npm is not found.
pause
exit /b

:INSTALL_ERROR
echo [ERROR] Installation failed.
pause
exit /b

:RUN_ERROR
echo [ERROR] Failed to start server.
pause
exit /b
