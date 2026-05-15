# AI Voice Comic Maker - Agent Instructions

## プロジェクト概要
4コマ漫画画像 + metadata.json → 声付きショート動画を全自動生成するアプリケーション。

## 技術スタック
- **Remotion 4.x**: 動画レンダリング (9:16 縦型)
- **VOICEVOX**: 音声合成 (ポータブル版自動DL)
- **Node.js 20 LTS**: ランタイム (自動インストール)
- **sharp**: 画像処理
- **TypeScript**: 開発言語

## プロジェクト隔離ルール
- ❌ **remotion_video_2 と絶対に混ぜないこと** (リモートリポジトリの汚染防止)
- ❌ **nano-banana-pro と絶対に混ぜないこと**
- ✅ `git remote -v` を必ず確認してから push すること

## ディレクトリ構成
```
short_movie/
├── start_ai-voice-comic-maker.bat  # Entry point
├── scripts/bootstrap.ps1  # 全自動環境構築
├── run_pipeline.js        # 統合パイプライン
├── generate-voiceover.ts  # VOICEVOX音声生成
├── src/                   # Remotion ソース
│   ├── compositions/      # 動画コンポジション
│   ├── components/        # UIコンポーネント
│   └── lib/               # ビジネスロジック
├── input/                 # ユーザー入力
├── public/                # 静的アセット
└── out/                   # 出力動画
```

## 重要な設計パターン
1. **BOM自動除去**: Windows環境での `package.json` BOM問題対策
2. **ロックファイル**: `.pipeline_lock` による二重実行防止
3. **カスケードタイムアウト**: パイプライン全体30分 + 各ステージ個別
4. **UTF-8強制**: 全コマンドで `chcp 65001` / `[Console]::OutputEncoding`
5. **出力タイムスタンプ命名**: `voice_comic_YYYYMMDDHHMMSS.mp4`
