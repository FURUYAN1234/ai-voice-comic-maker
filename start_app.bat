@echo off
chcp 65001 > nul
title AI Voice Comic Maker

echo ================================================================
echo   AI Voice Comic Maker - One-Click Launcher
echo   漫画をドロップするだけで、声付きショート動画を自動生成！
echo ================================================================
echo.

REM 環境セットアップ（Node.js / npm / VOICEVOX）
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\bootstrap.ps1" "%~dp0"

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo ❌ セットアップに失敗しました。上記のエラーメッセージを確認してください。
    pause
    exit /b 1
)

echo.
echo 🚀 Webアプリを起動します...
echo    フロントエンド: http://localhost:5173
echo    バックエンド:   http://localhost:3001
echo.

cd /d "%~dp0"

REM フロントエンド(Vite) + バックエンド(Express) を同時起動
REM ブラウザが自動で開く
start "" "http://localhost:5173"
npm run dev

pause
