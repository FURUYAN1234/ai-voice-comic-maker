# Project Standards: short_movie (AI Voice Comic Maker)

## 技術スタック
- Node.js 20 LTS (Express バックエンド)
- Remotion 4.x (9:16 縦型動画レンダリング)
- VOICEVOX (音声合成)
- sharp (画像処理)
- TypeScript/JavaScript

## コーディング規約
- BOM自動除去: Windows環境での package.json BOM問題対策を維持する。
- ロックファイル: `.pipeline_lock` による二重実行防止を厳守。
- UTF-8強制: 全コマンドで `chcp 65001` / `[Console]::OutputEncoding` を使用。
- 命名規則: 出力動画は `voice_comic_YYYYMMDDHHMMSS.mp4` とすること。

## 禁止事項
- **テスト用スクリプトや空フォルダを勝手に作成しないこと。** 検証は `start_ai-voice-comic-maker.bat` を起動して実ファイルで行う。
- 他プロジェクト名（Nano Banana Pro等）をコードに混入させない。
- `remotion_video_2` リポジトリと混同しないこと。隔離を徹底する。
