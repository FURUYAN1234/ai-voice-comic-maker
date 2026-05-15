<#
.SYNOPSIS
    AI Voice Comic Maker - 完全自動環境構築スクリプト
.DESCRIPTION
    Node.js, npm依存関係 (Remotion含む), VOICEVOX Engine を全自動でセットアップ。
    世界公開対応: ユーザーの手動インストールを徹底的に排除する。
#>

param(
    [string]$ProjectRoot = $PSScriptRoot
)

# UTF-8出力を強制
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

# プロジェクトルートに移動
if ($ProjectRoot -and (Test-Path $ProjectRoot)) {
    Set-Location $ProjectRoot
} else {
    Set-Location (Split-Path $PSScriptRoot -Parent)
}

$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  🔧 環境セットアップを開始します..." -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# ─────────────────────────────────────
# Step 1: Node.js のチェック＆自動インストール
# ─────────────────────────────────────
Write-Host "📦 [Step 1/3] Node.js の確認..." -ForegroundColor Yellow

$nodeExists = $false
try {
    $nodeVersion = & node --version 2>$null
    if ($nodeVersion) {
        Write-Host "  ✅ Node.js $nodeVersion が検出されました。" -ForegroundColor Green
        $nodeExists = $true
    }
} catch {
    # Node.js が見つからない
}

if (-not $nodeExists) {
    Write-Host "  ⚠️ Node.js が見つかりません。自動インストールを試みます..." -ForegroundColor Yellow
    
    # winget を試行
    $wingetExists = $false
    try {
        $wingetVersion = & winget --version 2>$null
        if ($wingetVersion) { $wingetExists = $true }
    } catch {}
    
    if ($wingetExists) {
        Write-Host "  📥 winget を使って Node.js 20 LTS をインストール中..." -ForegroundColor Cyan
        try {
            & winget install OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements --silent
            Write-Host "  ✅ Node.js のインストール完了！" -ForegroundColor Green
            
            # PATHを再読み込み
            $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")
        } catch {
            Write-Host "  ❌ winget でのインストールに失敗しました。" -ForegroundColor Red
        }
    }
    
    # winget が使えない、またはインストール失敗した場合 → 直接ダウンロード
    $nodeStillMissing = $true
    try {
        $nodeCheck = & node --version 2>$null
        if ($nodeCheck) { $nodeStillMissing = $false }
    } catch {}
    
    if ($nodeStillMissing) {
        Write-Host "  📥 Node.js を直接ダウンロードしてインストール中..." -ForegroundColor Cyan
        $nodeInstallerUrl = "https://nodejs.org/dist/v20.18.3/node-v20.18.3-x64.msi"
        $nodeInstallerPath = Join-Path $env:TEMP "node_installer.msi"
        
        try {
            [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
            Invoke-WebRequest -Uri $nodeInstallerUrl -OutFile $nodeInstallerPath -UseBasicParsing
            
            Write-Host "  🔧 サイレントインストール実行中..." -ForegroundColor Cyan
            Start-Process -FilePath "msiexec.exe" -ArgumentList "/i", $nodeInstallerPath, "/quiet", "/norestart" -Wait -NoNewWindow
            
            # PATHを再読み込み
            $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")
            
            # インストール後の確認
            $finalNodeCheck = & node --version 2>$null
            if ($finalNodeCheck) {
                Write-Host "  ✅ Node.js $finalNodeCheck のインストール完了！" -ForegroundColor Green
            } else {
                Write-Host "  ❌ Node.js のインストールに失敗しました。" -ForegroundColor Red
                Write-Host "  👉 https://nodejs.org/ から手動でインストールしてください。" -ForegroundColor Yellow
                exit 1
            }
        } catch {
            Write-Host "  ❌ ダウンロードに失敗しました: $($_.Exception.Message)" -ForegroundColor Red
            Write-Host "  👉 https://nodejs.org/ から手動でインストールしてください。" -ForegroundColor Yellow
            exit 1
        } finally {
            # インストーラーの削除
            if (Test-Path $nodeInstallerPath) {
                Remove-Item $nodeInstallerPath -Force -ErrorAction SilentlyContinue
            }
        }
    }
}

# ─────────────────────────────────────
# Step 2: npm install (Remotion + 全依存関係)
# ─────────────────────────────────────
Write-Host ""
Write-Host "📦 [Step 2/3] npm 依存関係 (Remotion含む) の確認..." -ForegroundColor Yellow

if (-not (Test-Path "node_modules")) {
    Write-Host "  📥 初回セットアップ: npm install を実行中..." -ForegroundColor Cyan
    Write-Host "  ⏳ Remotionを含む全パッケージをダウンロードします（数分かかります）..." -ForegroundColor Gray
    
    & npm install 2>&1 | ForEach-Object { Write-Host "  $_" }
    
    if ($LASTEXITCODE -ne 0) {
        Write-Host "  ❌ npm install に失敗しました。ネットワーク接続を確認してください。" -ForegroundColor Red
        exit 1
    }
    Write-Host "  ✅ 全パッケージのインストール完了！" -ForegroundColor Green
} else {
    Write-Host "  ✅ node_modules は既に存在します。スキップ。" -ForegroundColor Green
}

# ─────────────────────────────────────
# Step 3: VOICEVOX Engine のチェック＆自動セットアップ
# ─────────────────────────────────────
Write-Host ""
Write-Host "🗣️ [Step 3/3] VOICEVOX Engine の確認..." -ForegroundColor Yellow

$voicevoxRunning = $false
try {
    $response = Invoke-WebRequest -Uri "http://127.0.0.1:50021/version" -TimeoutSec 3 -UseBasicParsing -ErrorAction SilentlyContinue
    if ($response.StatusCode -eq 200) {
        Write-Host "  ✅ VOICEVOX Engine は既に稼働中です。(ver: $($response.Content))" -ForegroundColor Green
        $voicevoxRunning = $true
    }
} catch {
    # 応答なし → 起動が必要
}

if (-not $voicevoxRunning) {
    # ポータブル版の存在確認
    $voicevoxDir = Join-Path $PSScriptRoot ".." "bin" "voicevox"
    $voicevoxExe = $null

    # bin/voicevox 内の run.exe を再帰的に探索
    if (Test-Path $voicevoxDir) {
        $found = Get-ChildItem -Path $voicevoxDir -Recurse -Filter "run.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($found) {
            $voicevoxExe = $found.FullName
        }
    }
    
    # 標準インストール場所もチェック
    if (-not $voicevoxExe) {
        $standardPaths = @(
            (Join-Path $env:LOCALAPPDATA "Programs\VOICEVOX\vv-engine\run.exe"),
            (Join-Path $env:LOCALAPPDATA "Programs\VOICEVOX\run.exe"),
            "C:\Program Files\VOICEVOX\run.exe"
        )
        foreach ($p in $standardPaths) {
            if (Test-Path $p) {
                $voicevoxExe = $p
                break
            }
        }
    }

    if (-not $voicevoxExe) {
        Write-Host "  ⚠️ VOICEVOX Engine が見つかりません。" -ForegroundColor Yellow
        Write-Host "  📥 ポータブル版を自動ダウンロードします..." -ForegroundColor Cyan
        
        # VOICEVOX Engine ポータブル版のダウンロード
        # 最新の安定版を GitHub Releases から取得
        $vvZipUrl = "https://github.com/VOICEVOX/voicevox_engine/releases/download/0.21.1/voicevox_engine-windows-directml-0.21.1.vvpp.zip"
        $vvZipPath = Join-Path $env:TEMP "voicevox_engine.zip"
        
        # bin/voicevox ディレクトリを作成
        $vvTargetDir = Join-Path (Split-Path $PSScriptRoot -Parent) "bin" "voicevox"
        if (-not (Test-Path $vvTargetDir)) {
            New-Item -ItemType Directory -Path $vvTargetDir -Force | Out-Null
        }
        
        try {
            Write-Host "  ⏳ ダウンロード中... (約1GB、お時間がかかります)" -ForegroundColor Gray
            [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
            
            # 進捗表示付きダウンロード
            $webClient = New-Object System.Net.WebClient
            $webClient.DownloadFile($vvZipUrl, $vvZipPath)
            
            Write-Host "  📦 展開中..." -ForegroundColor Cyan
            Expand-Archive -Path $vvZipPath -DestinationPath $vvTargetDir -Force
            
            # 展開後に run.exe を探す
            $found = Get-ChildItem -Path $vvTargetDir -Recurse -Filter "run.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
            if ($found) {
                $voicevoxExe = $found.FullName
                Write-Host "  ✅ VOICEVOX Engine のダウンロード＆展開完了！" -ForegroundColor Green
            } else {
                Write-Host "  ⚠️ run.exe が見つかりません。手動でVOICEVOXをインストールしてください。" -ForegroundColor Yellow
                Write-Host "  👉 https://voicevox.hiroshiba.jp/" -ForegroundColor Yellow
            }
        } catch {
            Write-Host "  ❌ ダウンロードに失敗しました: $($_.Exception.Message)" -ForegroundColor Red
            Write-Host "  👉 https://voicevox.hiroshiba.jp/ から手動でインストールしてください。" -ForegroundColor Yellow
        } finally {
            if (Test-Path $vvZipPath) {
                Remove-Item $vvZipPath -Force -ErrorAction SilentlyContinue
            }
        }
    }

    # VOICEVOX Engine をサイレント起動
    if ($voicevoxExe) {
        Write-Host "  🚀 VOICEVOX Engine をバックグラウンドで起動中..." -ForegroundColor Cyan
        
        # ウィンドウを非表示にして起動
        $psi = New-Object System.Diagnostics.ProcessStartInfo
        $psi.FileName = $voicevoxExe
        $psi.Arguments = "--host 127.0.0.1 --port 50021"
        $psi.WindowStyle = [System.Diagnostics.ProcessWindowStyle]::Hidden
        $psi.CreateNoWindow = $true
        $psi.UseShellExecute = $false
        [System.Diagnostics.Process]::Start($psi) | Out-Null
        
        # 起動完了を待つ（最大30秒）
        Write-Host "  ⏳ エンジン起動待ち (最大30秒)..." -ForegroundColor Gray
        $maxWait = 30
        $waited = 0
        $engineReady = $false
        
        while ($waited -lt $maxWait) {
            Start-Sleep -Seconds 2
            $waited += 2
            try {
                $healthCheck = Invoke-WebRequest -Uri "http://127.0.0.1:50021/version" -TimeoutSec 2 -UseBasicParsing -ErrorAction SilentlyContinue
                if ($healthCheck.StatusCode -eq 200) {
                    $engineReady = $true
                    break
                }
            } catch {}
            Write-Host "  ⏳ 待機中... ($waited/$maxWait 秒)" -ForegroundColor Gray
        }
        
        if ($engineReady) {
            Write-Host "  ✅ VOICEVOX Engine が正常に起動しました！" -ForegroundColor Green
        } else {
            Write-Host "  ⚠️ VOICEVOX Engine の起動に時間がかかっています。" -ForegroundColor Yellow
            Write-Host "  パイプライン内で再度接続を試みます。" -ForegroundColor Gray
        }
    }
}

# ─────────────────────────────────────
# セットアップ完了
# ─────────────────────────────────────
Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  ✅ 環境セットアップ完了！" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""

exit 0
