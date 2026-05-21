# AI Voice Comic Maker - Walkthrough (v1.3.9)

## 目的
Gemini Vision OCRのパースエラー（「AIの応答からメタデータを抽出できませんでした」）の解消、PlayStationシリーズの発音補正、および本番環境へのリリースと、全アプリのフル環境バックアップを一気通貫で実施する。

## 変更内容
1. **GeminiレスポンスのJSONフォーマット強制**
   - `server.js` 内の Gemini API 呼び出しパラメータ（`generationConfig`）に `responseMimeType: "application/json"` を追加。
   - これにより、低温度（temperature: 0.1）およびプロンプト厳格化の環境下でも、Geminiが説明文などを交えず純粋なJSONのみを返却するように固定し、パースエラーの発生を根本解決。
2. **PlayStationシリーズの発音補正**
   - プリセット発音辞書（`PRONUNCIATION_DICT`）に `PS3`, `PS2`, `PS1`, `PS` を追加し、PS2などの固有名詞がVOICEVOXで「プレステツー」などと正しく読み上げられるよう修正。
3. **不要な重複モデル定義の削除**
   - `server.js` の930行目にあった、未使用かつパラメータ設定のない `getGenerativeModel` のインスタンス化をクリーンアップ。
4. **エラーハンドリングの強化**
   - 万が一JSONパースが失敗した場合に備え、デバッグしやすくなるよう生レスポンス（`responseText`）をコンソールに出力するログ処理を追加。

## 検証結果
### 1. デプロイ検証
- `npm run build` および `npm run deploy` が正常に完了。
- サーバー側の `git show origin/gh-pages:index.html` を確認し、バージョン表記が `<title>AI Voice Comic Maker v1.3.9</title>` に更新されていることを検証。
- リポジトリにタグ `v1.3.9` を付与し、GitHub Release を作成。
- リリースZIPを自動ダウンロードし、`C:\ai-voice-comic-maker-main` への差し替え展開が正常に行われることを検証。

### 2. 環境フルバックアップ検証
- `backup_launch.bat` を経由して `backup_full.ps1` を実行し、デスクトップ上に進捗画面（黒い窓）が正常にポップアップすることを確認。
- 各アプリ設定、.gemini（ルール、ナレッジ、MCP）、Gitハッシュ、環境変数テンプレート等を自動収集してZIPを生成し、Google Driveへの同期コピーが完了。

## 今後の注意点（引き継ぎ事項）
> [!IMPORTANT]
> **バックアップ実行時のUI表示について**
> AIエージェントからフルバックアップを実行する場合、直接 `backup_full.ps1` をたたくとバックグラウンドで隠れて実行され、進捗状況（黒い窓）がユーザーの画面に表示されません。
> **今後もバックアップ実行時は、必ず `C:\Users\sx717\Antigravity\backup_launch.bat` を経由して実行すること。** これにより `Start-Process` が走り、デスクトップ上に新しい黒い窓がポップアップされ、ユーザーが進捗を視認できるようになります。
