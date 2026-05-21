# AI Voice Comic Maker - Walkthrough (v1.4.0)

## 目的
マイナーアップデート **v1.4.0** への正式リリース（GitHub Pages デプロイ、Tag/Release、展開検証）および、開発環境のフルバックアップ（別窓ポップアップ表示）を一気通貫で実施する。

## 変更内容
1. **バージョンを v1.4.0 へ更新**
   - ユーザーからの指摘に基づき、セマンティックバージョニングに準拠してマイナーバージョン `v1.4.0` にインクリメント。
   - `package.json`, `src/App.jsx`, `index.html`, `README.md`, `release_info.md` のバージョン表記を `1.4.0` に統一。
2. **リリースと環境フルバックアップの一気通貫プロトコル実行**
   - プロダクションビルドおよび GitHub Pages へのデプロイを実行。
   - アノテーテッドタグ `v1.4.0` の作成・プッシュ。
   - `release_info.md` に基づく GitHub Release 作成。
   - リリースZIPをダウンロードし、`C:\ai-voice-comic-maker-main` への展開とバージョン検証。
3. **環境フルバックアップの起動（仕掛かり中）**
   - `backup_launch.bat` を経由して `backup_full.ps1` を別ウィンドウ（黒い窓）でポップアップ起動。

## 検証結果
### 1. デプロイ検証
- `npm run build` および `npm run deploy` が正常に完了。
- リモート側の `git show origin/gh-pages:index.html` を確認し、バージョン表記が `<title>AI Voice Comic Maker v1.4.0</title>` に更新されていることを検証。
- リポジトリにタグ `v1.4.0` を付与し、GitHub Release を作成完了。
- リリースZIPを自動ダウンロードし、`C:\ai-voice-comic-maker-main` への差し替え展開が正常に行われ、`package.json` のバージョンが `1.4.0` であることを検証。

### 2. 環境フルバックアップ検証
- `backup_launch.bat` を経由して `backup_full.ps1` を実行し、デスクトップ上に進捗画面（黒い窓）が正常にポップアップして実行されたことを確認予定。

## 今後の注意点
> [!IMPORTANT]
> **バックアップ実行時のUI表示について**
> AIエージェントからフルバックアップを実行する場合、直接 `backup_full.ps1` をたたくとバックグラウンドで隠れて実行され、進捗状況（黒い窓）がユーザーの画面に表示されません。
> **今後もバックアップ実行時は、必ず `C:\Users\sx717\Antigravity\backup_launch.bat` を経由して実行すること。** これにより `Start-Process` が走り、デスクトップ上に新しい黒い窓がポップアップされ、ユーザーが進捗を視認できるようになります。
