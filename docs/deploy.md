# Deploy Rules: short_movie

共通手順の正本は `C:\Users\sx717\Antigravity\docs\unified_release_completion.md`、契約は `scripts\release-apps.json` の `short_movie`、実行入口は `scripts\publish_app_release.ps1` である。

- GitHubの現在設定では `FURUYAN1234/ai-voice-comic-maker` の `gh-pages` がPages sourceとして有効である。ローカル専用・Pages対象外という旧ルールは廃止済み。
- GitHub Pages、GitHub Release、GitHub source ZIP由来の `C:\short_movie-main`、最終公開検証を共通レシートで完遂する。
- Hugging Faceは対象外。
- `node scripts/pre_deploy_check.js` は共通transactionのapp validationとして必須。
- ローカルlauncherの検証がそのreleaseの受入条件に含まれる場合も、Pages/Release/Cコピー工程の代用にはしない。
- フルバックアップは別の明示操作であり、自動開始しない。

```powershell
powershell -ExecutionPolicy Bypass -File ..\scripts\publish_app_release.ps1 -App short_movie -NotesPath <absolute-vX.Y.Z.md> -ReleaseTitle "Short Movie vX.Y.Z"
```
