@echo off
chcp 65001 > nul
setlocal EnableDelayedExpansion
cd /d "%~dp0"

echo ============================================
echo   AI Voice Comic Maker - Starting...
echo ============================================


REM --- Basic Environment Check ---
where node >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Node.js is missing. Please install Node.js.
    pause
    exit /b
)

if not exist node_modules (
    echo [INFO] node_modules not found. Installing...
    call npm install
)

REM --- Remotion Dependencies Check ---
if not exist "node_modules\@remotion\cli" (
    echo [INFO] Remotion packages not found. Installing...
    call npm install
)

REM --- VOICEVOX Engine Check ---
echo [INFO] Checking VOICEVOX Engine...
curl -s -o nul -w "%%{http_code}" http://127.0.0.1:50021/version > "%TEMP%\vv_status.txt" 2>nul
set /p VVSTATUS=<"%TEMP%\vv_status.txt"
del "%TEMP%\vv_status.txt" 2>nul

if "!VVSTATUS!"=="200" (
    echo [OK] VOICEVOX Engine is already running.
    goto LAUNCH_APP
)

echo [INFO] VOICEVOX Engine is not running. Searching for installation...

REM ========================================================
REM   Dynamic VOICEVOX Path Detection
REM ========================================================
set "VV_EXE="

REM --- Method 1: Search system PATH ---
echo [INFO] Method 1/4: Searching PATH...
for /f "delims=" %%i in ('where VOICEVOX.exe 2^>nul') do (
    if not defined VV_EXE set "VV_EXE=%%i"
)
if defined VV_EXE (
    echo [OK] Found in PATH: !VV_EXE!
    goto START_VV
)

REM --- Method 2: Search Windows Registry via PowerShell ---
echo [INFO] Method 2/4: Searching Windows Registry...
for /f "delims=" %%P in ('powershell -NoProfile -Command "Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*','HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*','HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*' -EA 0 | Where-Object { $_.DisplayName -like '*VOICEVOX*' -and $_.InstallLocation } | Select-Object -ExpandProperty InstallLocation -First 1" 2^>nul') do (
    if exist "%%P\VOICEVOX.exe" set "VV_EXE=%%P\VOICEVOX.exe"
    if not defined VV_EXE if exist "%%PVOICEVOX.exe" set "VV_EXE=%%PVOICEVOX.exe"
)
if defined VV_EXE (
    echo [OK] Found in Registry: !VV_EXE!
    goto START_VV
)

REM --- Method 3: Check common installation paths ---
echo [INFO] Method 3/4: Checking common install locations...
for %%D in (
    "%LocalAppData%\Programs\VOICEVOX\VOICEVOX.exe"
    "%ProgramFiles%\VOICEVOX\VOICEVOX.exe"
    "%ProgramFiles(x86)%\VOICEVOX\VOICEVOX.exe"
    "%USERPROFILE%\AppData\Local\Programs\VOICEVOX\VOICEVOX.exe"
    "%LocalAppData%\VOICEVOX\VOICEVOX.exe"
    "C:\VOICEVOX\VOICEVOX.exe"
    "D:\VOICEVOX\VOICEVOX.exe"
) do (
    if exist %%D (
        set "VV_EXE=%%~D"
        echo [OK] Found: !VV_EXE!
        goto START_VV
    )
)

REM --- Method 4: Not found - offer winget install ---
echo [WARN] VOICEVOX is not installed on this system.
echo [INFO] Method 4/4: Attempting automatic install via winget...
winget install -e --id HiroshibaKazuyuki.VOICEVOX --accept-source-agreements --accept-package-agreements
if errorlevel 1 (
    echo [WARN] winget install failed. Continuing without VOICEVOX.
    echo         Download: https://voicevox.hiroshiba.jp/
    goto LAUNCH_APP
)
echo.
echo ========================================================
echo [IMPORTANT] Installation appears to be complete.
echo Please CLOSE this window to apply environment variables,
echo and then run this batch file again.
echo ========================================================
pause
exit /b

REM ========================================================
REM   Start VOICEVOX and wait for Engine API
REM ========================================================
:START_VV
echo [INFO] Starting VOICEVOX: !VV_EXE!
start "" "!VV_EXE!"

set VV_ATTEMPTS=0
:WAIT_VV
set /a VV_ATTEMPTS+=1
echo [INFO] Waiting for VOICEVOX Engine to respond...
timeout /t 5 /nobreak >nul
curl -s -o nul -w "%%{http_code}" http://127.0.0.1:50021/version > "%TEMP%\vv_status.txt" 2>nul
set /p VV_RECHECK=<"%TEMP%\vv_status.txt"
del "%TEMP%\vv_status.txt" 2>nul
if "!VV_RECHECK!"=="200" (
    echo [OK] VOICEVOX Engine is ready.
    goto LAUNCH_APP
)
if !VV_ATTEMPTS! GEQ 12 (
    echo [WARN] VOICEVOX Engine did not respond. Continuing to Supertonic 3 check.
    goto LAUNCH_APP
)
goto WAIT_VV

REM ========================================================
REM   Launch Application
REM ========================================================
:LAUNCH_APP
REM --- Supertonic 3 TTS Engine Check ---
echo [INFO] Checking Supertonic 3 TTS Engine...

where python >nul 2>nul
if errorlevel 1 (
    echo [WARN] Python is not installed. Supertonic 3 will not be available.
    echo [WARN] VOICEVOX will be used as the primary local Japanese TTS engine.
    goto RUN_APP
)

python -c "import supertonic" >nul 2>nul
if errorlevel 1 (
    echo [INFO] Supertonic 3 not found. Installing via pip...
    python -m pip install "supertonic[serve]"
    if errorlevel 1 (
        echo [WARN] Failed to install Supertonic 3. Continuing without it.
        goto RUN_APP
    )
)

curl -s -o nul -w "%%{http_code}" http://127.0.0.1:7789/v1/health > "%TEMP%\st_status.txt" 2>nul
set /p STSTATUS=<"%TEMP%\st_status.txt"
del "%TEMP%\st_status.txt" 2>nul
if "!STSTATUS!"=="200" (
    echo [OK] Supertonic 3 serve is already running.
    goto RUN_APP
)

echo [INFO] Starting Supertonic 3 serve on port 7789...
start /B supertonic serve --host 127.0.0.1 --port 7789

set ST_ATTEMPTS=0
:WAIT_ST
set /a ST_ATTEMPTS+=1
echo [INFO] Waiting for Supertonic 3 to respond...
timeout /t 3 /nobreak >nul
curl -s -o nul -w "%%{http_code}" http://127.0.0.1:7789/v1/health > "%TEMP%\st_status.txt" 2>nul
set /p ST_RECHECK=<"%TEMP%\st_status.txt"
del "%TEMP%\st_status.txt" 2>nul
if "!ST_RECHECK!"=="200" (
    echo [OK] Supertonic 3 is ready.
    goto RUN_APP
)
if !ST_ATTEMPTS! LSS 5 goto WAIT_ST
echo [WARN] Supertonic 3 did not start. Continuing with VOICEVOX only.

:RUN_APP
echo [INFO] Launching frontend + backend server...
call npm run dev

if errorlevel 1 goto RUN_ERROR
pause
exit /b

:RUN_ERROR
echo [ERROR] Failed to start server.
pause
exit /b

