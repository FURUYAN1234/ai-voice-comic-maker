# AI Voice Comic Maker - Walkthrough

## 目的
Gemini Vision OCR を用いて、4コマ漫画画像ドロップのみで全自動でメタデータ（タイトル・セリフ・話者・感情・コマ分割）を生成し、VOICEVOXでの音声合成、およびRemotionによるサーバーサイドプログラマティックレンダリングを実行する。

## テスト内容
1. **E2Eテストスクリプト作成**: `test-e2e.js` を作成し、バックエンドの各エンドポイント (`/api/upload`, `/api/analyze`, `/api/generate`) を順番に呼び出すよう実装。
2. **モックデータによるOCRフェーズ検証**: APIキーが設定されていない場合でもE2Eパイプラインを走らせられるよう、`server.js` 側で `input/sample/metadata.json` を使用するフォールバックを実装。
3. **画像分割 (sharp) 連携**: `server.js` 内で自動的に `public/panels/` へ分割画像を格納。
4. **プログラマティックレンダリング**: `@remotion/bundler` と `@remotion/renderer` を用いて、`scriptData` から動画を生成。

## 実行結果
- サーバーの再起動後、`npm run dev` 経由でフロントエンドおよびバックエンドが正常に立ち上がったことを確認。
- `test-e2e.js` を実行し、API 経由で動画ファイルが `out/` ディレクトリに生成されることを確認した。
  - **出力ファイル**: `out/voice_comic_20260515104933.mp4` (約33MB)
  - 動画は H264 コーデックでレンダリングされ、全てのコマ、字幕、Ken Burns エフェクトが正常に処理された。

## 次のステップ
- 本番環境での運用時に Gemini API Key を設定し、実際のOCR解析からレンダリングまでを通しで行う運用検証。
- フロントエンドにおけるエラー発生時のユーザー体験の改善。
