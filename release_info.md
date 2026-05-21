v1.4.0: Deploy, Complete Environment Backup & Gemini OCR / PS Pronunciation Fixes / デプロイ、環境フルバックアップおよびGemini OCR・PSシリーズ発音辞書修正

## What's New / 更新内容
- Gemini Vision OCRに `responseMimeType: "application/json"` を適用し、解析エラーの主な原因であった不正なJSONや説明文テキストの混入を完全に防止。 / Enforced Gemini Vision OCR response as JSON via responseMimeType configuration to mitigate parsing errors.
- 発音補正辞書にPlayStationシリーズ（`PS3`, `PS2`, `PS1`, `PS`）を追加し、PS2画像等をドロップした際の発音（「プレステツー」など）を正確に補正。 / Added PlayStation series (PS3, PS2, PS1, PS) to the pronunciation dictionary to correct voice synthesis pronunciation.
- 重複する未使用コードの削除およびクリーンアップ。 / Cleaned up duplicate model definition code.
- バージョンをv1.4.0に更新し、GitHub Pagesデプロイ手順および全アプリフルバックアッププロトコルを実行。 / Incremented version to v1.4.0 and executed GitHub Pages deployment along with a complete workspace environment backup.
