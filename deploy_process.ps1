[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Write-Host "
=== Step 4: Build & Deploy ==="
npm run build
npm run deploy

Write-Host "
=== Step 5: Verification (Waiting 60s) ==="
Start-Sleep -Seconds 60
git fetch origin gh-pages
git show origin/gh-pages:index.html | Select-String "1.5.8"

Write-Host "
=== Step 6: Commit & Push ==="
git add -A
git commit -m "v1.5.8: バグ修正と精度向上"
git push origin master

Write-Host "
=== Step 7: Tagging ==="
git tag -a v1.5.8 -m "v1.5.8: Bug Fixes / バグ修正"
git push origin v1.5.8

Write-Host "
=== Step 8: GitHub Release ==="
$notes = "## What's New / 更新内容
- Fixed a frontend state management bug where progress logs were improperly deduplicated.
- Restructured the 2-Pass AI auto-correction payload to include the manga title, allowing the LLM to self-correct contextual keywords in the title itself.
- Strictly hardened the Vision OCR prompt to coerce OpenAI models into parsing minor texts like posters, flags, and signs, eradicating text skipping issues."
gh release create v1.5.8 --title "v1.5.8: Bug Fixes / バグ修正" --notes $notes

Write-Host "
=== Step 9: ZIP Verification & C Drive Replace ==="
$repoName = "ai-voice-comic-maker"
$zipPath = "$env:TEMP\$repoName-v1.5.8.zip"
gh release download v1.5.8 --archive zip --output $zipPath
if (Test-Path $zipPath) {
    Write-Host "ZIP downloaded successfully."
    Remove-Item -Recurse -Force "C:\$repoName-main" -ErrorAction SilentlyContinue
    Remove-Item -Recurse -Force "C:\temp-unzip-avc" -ErrorAction SilentlyContinue
    New-Item -ItemType Directory -Path "C:\temp-unzip-avc" | Out-Null
    Expand-Archive -Path $zipPath -DestinationPath "C:\temp-unzip-avc" -Force
    $extractedFolder = Get-ChildItem "C:\temp-unzip-avc" | Where-Object { $_.PSIsContainer } | Select-Object -First 1
    Move-Item -Path $extractedFolder.FullName -Destination "C:\$repoName-main" -Force
    Remove-Item -Recurse -Force "C:\temp-unzip-avc"
    Write-Host "C drive replacement complete: C:\$repoName-main"
} else {
    Write-Host "ZIP download failed!"
}

Write-Host "
=== Step 10: Running Global Backup ==="
C:\Users\sx717\Antigravity\backup_launch.bat
