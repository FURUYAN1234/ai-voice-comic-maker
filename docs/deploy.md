# Deploy Rules & Full Protocol: short_movie (AI Voice Comic Maker)

CodexおよびAntigravityがデプロイ・リリース作業を行う際の手順書です。

## 1. Deploy Targets & Environment
- **Deploy Target**: ローカル実行専用アプリケーション
- **Not Applicable**: GitHub Pages, Hugging Face Spaces, Vercel, Netlify
- **起動方法**: `start_ai-voice-comic-maker.bat` を叩いてバックエンド(Express)とフロントエンド(Vite)をローカルで起動する運用です。外部サーバーへのデプロイ（`npm run deploy`等）は**絶対に行わないでください。**

## 2. Version Bump Targets (バージョン更新対象ファイル)
機能追加・バグ修正時は以下のバージョン番号 (`vX.Y.Z`) を全て一致させること。
1. `package.json` (`"version": "X.Y.Z"`)
2. `package-lock.json`
3. `src/App.jsx` (`SYSTEM_VERSION`)
4. `index.html`
5. `README.md` (badge, headline, ChangeLog等)

## 3. Pre-Release Audit (監査ルール)
リリース（Gitタグ付け）前に以下のチェックを必ず行うこと。
- **ゴミファイル**: テストスクリプト、一時ファイル、空ディレクトリが存在しないか。
- **個人情報/ローカルパス**: `C:\Users\...` などのパス、個人名、メールアドレスが含まれていないか。
- **公開禁止の固有名詞**: 他プロジェクト名（`Nano Banana Pro`, `remotion_video_2` 等）が混入していないか。
- **機密情報**: `.env` などのAPIキーがコミットされていないか。

## 4. Commit, Tag & Push Rules
デプロイ先はありませんが、ソースコードのバージョン管理として以下の手順を実行します。
- コミット: `vX.Y.Z: 変更概要`
- タグ: `git tag -a vX.Y.Z -m "vX.Y.Z: 変更概要 / Feature summary"` (日本語と英語の併記)
- プッシュ: `git push origin master` および `git push origin vX.Y.Z`

## 5. GitHub Release (リリース作成)
※ Codex側で `gh auth status` が invalid の場合はスキップし、Antigravityに引き継ぐこと。
- タイトル: `vX.Y.Z: Feature Name / 機能名`
- 本文: `## What's New / 更新内容` 以下に英日併記。
- コマンド: `gh release create vX.Y.Z --title "タイトル" --notes "本文"`

## 6. ZIP Extraction (バックアップ展開先ルール)
※ GitHub Release が作成された場合のみ実行。
- ダウンロード: `gh release download vX.Y.Z --archive zip --output $env:TEMP\short_movie-vX.Y.Z.zip`
- 展開先: `C:\short_movie-main` (既存フォルダを削除してから配置、二重フォルダに注意)

## 7. Full Workspace Backup (全体バックアップ手順)
※ 全ての作業完了後に全体バックアップが必要な場合のみ。
- 実行コマンド: `powershell -ExecutionPolicy Bypass -File <Antigravity>\scripts\backup_full.ps1`
