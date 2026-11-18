// Snapshot of maintained model options for standalone releases.
export default {
  "priceSnapshotDate": "2026-11-18",
  "priceSnapshotSource": "https://developers.openai.com/api/docs/pricing",
  "models": [
    {
      "id": "gpt-6.2-astra",
      "label": "GPT-6.2 Astra",
      "group": "GPT-6.2",
      "description": "複雑な指示や多段の判断を重視",
      "inputPriceUsdPerM": 8,
      "outputPriceUsdPerM": 40,
      "comparisonNote": "旧GPT-6 Astraより通常の入力・出力単価が20%低いモデルです。"
    },
    {
      "id": "gpt-6-astra",
      "label": "GPT-6 Astra",
      "group": "GPT-6",
      "description": "複雑な制約・演出を重視したシナリオ",
      "inputPriceUsdPerM": 10,
      "outputPriceUsdPerM": 50,
      "comparisonNote": "従来のAstraです。GPT-6.2 Astraと価格・出力を比較できます。"
    },
    {
      "id": "gpt-6.2-sol",
      "label": "GPT-6.2 Sol",
      "group": "GPT-6.2",
      "description": "複数の条件がある処理と料金のバランス",
      "inputPriceUsdPerM": 2,
      "outputPriceUsdPerM": 10,
      "comparisonNote": "通常の入力・出力単価はGPT-6.1 Solと同じです。"
    },
    {
      "id": "gpt-6.1-sol",
      "label": "GPT-6.1 Sol",
      "group": "GPT-6.1",
      "description": "新しいSol・構成品質と料金のバランス",
      "inputPriceUsdPerM": 2,
      "outputPriceUsdPerM": 10,
      "comparisonNote": "通常の入力・出力単価はAstraの5分の1。題材ごとの生成結果を確認してください。"
    },
    {
      "id": "gpt-6.1-terra",
      "label": "GPT-6.1 Terra",
      "group": "GPT-6.1",
      "description": "画像の理解と文章作成を素早く低コストで処理",
      "inputPriceUsdPerM": 1,
      "outputPriceUsdPerM": 5,
      "comparisonNote": "GPT-6.1 Solの半額の通常単価。画像解析や文章作成の結果は題材ごとに確認してください。"
    },
    {
      "id": "gpt-6-sol",
      "label": "GPT-6 Sol",
      "group": "GPT-6",
      "description": "複雑な構成と料金のバランスを重視",
      "inputPriceUsdPerM": 2,
      "outputPriceUsdPerM": 10,
      "comparisonNote": "Astraより入力・出力単価を抑えられます。実際のシナリオ品質は題材ごとに確認してください。"
    },
    {
      "id": "gpt-5.6-sol",
      "label": "GPT-5.6 Sol",
      "group": "GPT-5.6",
      "description": "高い構成力を保ちつつAstraより節約",
      "inputPriceUsdPerM": 4,
      "outputPriceUsdPerM": 20,
      "comparisonNote": "Astraより抑えつつ、複雑な構成や推論を重視したい場合に向きます。"
    },
    {
      "id": "gpt-5.6-terra",
      "label": "GPT-5.6 Terra",
      "group": "GPT-5.6",
      "description": "品質と料金のバランスを重視",
      "inputPriceUsdPerM": 2,
      "outputPriceUsdPerM": 12,
      "comparisonNote": "GPT-4.1と入力単価は同じ。出力は高めですが、題材解釈・構成を推論で補強します。"
    },
    {
      "id": "gpt-6-luna",
      "label": "GPT-6 Luna",
      "group": "GPT-6",
      "description": "料金を優先した軽量なシナリオ構成",
      "inputPriceUsdPerM": 0.1,
      "outputPriceUsdPerM": 0.5,
      "comparisonNote": "GPT-5.6 Lunaより入力・出力単価が低め。複雑な制約では生成結果を確認してください。"
    },
    {
      "id": "gpt-5.6-luna",
      "label": "GPT-5.6 Luna",
      "group": "GPT-5.6",
      "description": "簡潔な題材を最小コストで素早く構成",
      "inputPriceUsdPerM": 0.2,
      "outputPriceUsdPerM": 1.2,
      "comparisonNote": "大きく節約したい場合の第一候補。複雑な制約は上位モデルより弱くなります。"
    }
  ]
};
