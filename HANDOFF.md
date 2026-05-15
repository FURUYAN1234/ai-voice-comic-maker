# 🚀 AI Voice Comic Maker - Project Handoff

## 1. プロジェクトの目的とコンセプト
漫画画像をドロップするだけで、**Gemini Vision OCR が全自動でセリフ・話者・感情を解析**し、VOICEVOX音声合成 → Remotion動画レンダリングを経て「声付き縦型ショート動画（ボイスコミック）」を生成するスタンドアロン・アプリケーション。

**JSONは一切不要。画像をドロップするだけで全てAIが判断する。**

## 2. 現在のステータス
- **Phase 0 完了**: プロジェクト骨格構築済み
- **Phase 1 完了**: VOICEVOX自動セットアップ（bootstrap.ps1）
- **Phase 2 完了**: Gemini Vision OCR統合、音声合成パイプライン
- **Phase 3 完了**: @remotion/renderer によるサーバーサイド動画レンダリング統合、画像分割(sharp)の統合、E2Eテスト完了

## 3. 正式な処理フロー
```
漫画画像ドロップ
  → Gemini Vision OCR（セリフ・話者・コマ構成を全自動解析）
  → キャラクター→Voice ID 自動キャスティング
  → VOICEVOX 音声合成
  → sharp による4コマ画像分割
  → Remotion 動画レンダリング (9:16, 1080x1920)
  → 完成動画を内蔵プレーヤーで再生＆ダウンロード
```

## 4. 作成済みファイル一覧
- `package.json` - Remotion 4.0.428 + @google/generative-ai
- `tsconfig.json` / `remotion.config.ts` - TypeScript & Remotion設定
- `start_ai-voice-comic-maker.bat` - One-click launcher
- `scripts/bootstrap.ps1` - 全自動環境構築 (Node.js + npm + VOICEVOX)
- `server.js` - Express バックエンド（Gemini OCR + VOICEVOX統合）
- `src/App.jsx` - フロントエンドUI（画像のみドロップ + APIキー入力）
- `src/lib/gemini-ocr.ts` - Gemini Vision OCR モジュール
- `src/lib/slice-panels.ts` - 4コマ画像→個別コマ分割（sharp）
- `src/lib/cast-voices.ts` - キャラクター→Voice ID 自動キャスティング
- `src/lib/voicevox-client.ts` - VOICEVOX APIクライアント
- `src/compositions/VoiceComic.tsx` - メイン動画コンポジション
- `src/components/ComicPanel.tsx` - Ken Burnsエフェクト
- `src/components/Subtitle.tsx` - 字幕オーバーレイ
- `src/components/Transition.tsx` - トランジション

## 5. 完了したアクション
- `server.js` に `sharp` による画像分割ロジックを統合し、`public/panels/` への出力と `scriptData.json` へのパス連携を実装。
- `@remotion/bundler` と `@remotion/renderer` を用いたプログラマティックレンダリングを `server.js` に統合し、動的な動画尺（duration）を `Root.tsx` と連携。
- API キー未設定時用のモックOCRフローを E2E テスト用に追加。

## 6. 次のアクション (今後の展望)
- 実運用に向けたエラーハンドリングの強化や、VOICEVOXの起動状態監視など。
- デザインやUIのさらなるブラッシュアップ。

## 7. 設計上の重要な決定事項
- **画像のみ入力**: JSONは使わない。Gemini Vision OCRで全自動解析
- **世界公開対応**: Node.js/VOICEVOX/Remotion全自動インストール
- **プロジェクト隔離**: remotion_video_2 / nano-banana-pro とは絶対に混ぜない
- **Vanilla CSS**: Tailwind は使わない
- **APIキーはメモリのみ**: localStorageに永続化しない（セキュリティ）
