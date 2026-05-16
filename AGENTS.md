# AI Voice Comic Maker - Agent Instructions

## ⛔ 絶対遵守ルール (CRITICAL)

### 1. ゴミファイル厳禁
- テストスクリプト、検証用HTMLページ、一時ファイル等を**絶対に作成しないこと**
- 不要になったファイルは即座に削除すること
- 空ディレクトリを放置しないこと

### 2. テスト環境の作成禁止
- テストメニュー、テストページ、E2Eスクリプト等を**勝手に作らないこと**
- 検証は**ローカルのバッチファイル (`start_ai-voice-comic-maker.bat`) を起動して実際に画像を投げる**方法のみ
- 「検証用に作りましょうか？」と提案することも禁止

### 3. 個人情報・固有名詞の記載禁止
- ソースコード内にローカルパス (`C:\Users\...`)、個人名、メールアドレス等を記載しないこと
- 他プロジェクトの固有名詞（「Nano Banana Pro」等）をソースコード内に混入させないこと
- これらは**直見の侵害**に該当する

## プロジェクト概要
4コマ漫画画像をドロップするだけ → Gemini Vision OCR で全自動解析 → VOICEVOX音声合成 → Remotion動画レンダリング → 声付きショート動画を生成。JSONは一切不要、全てAIが判断する。

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
├── start_ai-voice-comic-maker.bat  # Entry point (ワンクリック起動)
├── server.js              # Express バックエンド (全処理統合)
├── generate_bgm.js        # プロシージャル作曲エンジン
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
6. **右→左読み順強制**: 各コマ内のセリフを `bubblePosition` で右→中→左にソート

## デプロイ時の必須監査項目
1. **ゴミファイル監査**: テストスクリプト、一時ファイル、空ディレクトリが残っていないか確認
2. **個人情報監査**: ソースコード内にローカルパス、個人名、固有名詞が混入していないか確認
3. **Gemini モデル監査**: `server.js` 内の `modelsToTry` リストが最新かチェック
4. **SYSTEM_VERSION 同期**: `src/App.jsx` の `SYSTEM_VERSION` が他の全バージョン表記と一致しているか確認
