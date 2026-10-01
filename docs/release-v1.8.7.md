# v1.8.7

## 日本語
- ページ外の制作クレジット読み上げを修正。文字役割・ページ領域を必須にし、校正前後と音声直前で除外。物語ナレーション・台詞・URL・擬音を保持。分類欠落は追加課金せず停止。
- 全11モデルの選択・価格表示を追加。Astra最上位、6.1 Sol既定。選択モデルから下位のみ試行し、選択・試行・採用を表示。不明IDは呼び出し前に拒否。
- OpenAIテキスト・画像解析の既定をGPT-6.1 Solに更新。既存GPT-4.1以降のフォールバックを維持。
- 推論用出力上限を確保。途中終了・空応答・拒否を成功扱いせず、認証・残高不足・ポリシー拒否で連続試行を停止。
- 画像生成モデル・軽量補助処理・既存品質ルールは維持。

## English
- Fix page production credits being narrated. Require text-role/page-region evidence and apply the common gate before/after correction and before speech; preserve story narration, dialogue, URLs and SFX. Missing classification stops synthesis without another paid attempt.
- Add all 11 model options and pricing, Astra highest and 6.1 Sol default. Attempt only the selected model and lower models; display selection, attempts and adoption; reject unknown IDs before calls.
- Default OpenAI text and Vision to GPT-6.1 Sol with the retained GPT-4.1 fallback chain.
- Reserve reasoning completion budget; reject incomplete, empty and refused output. Stop retries on output-budget exhaustion, authentication, billing/quota and policy failures.
- Preserve image models, lite helpers and quality rules.
