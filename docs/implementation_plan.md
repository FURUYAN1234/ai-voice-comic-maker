# 🎬 AI Voice Comic Maker - 実装計画書

> **プロジェクト名**: short_movie (AI Voice Comic Maker)
> **ワークスペース**: `short_movie` (ローカル開発環境)
> **作成日**: 2026-05-15
> **ステータス**: Phase 0 - 設計＆骨格構築

---

## 1. プロジェクト概要

### コンセプト
Nano Banana Pro等で生成された「4コマ漫画画像」と「metadata.json」をドロップするだけで、**完全自動**で「声付き・動き付きの縦型ショート動画（ボイスコミック）」を生成するスタンドアロン・アプリケーション。

### 設計哲学
- **One-Click Magic**: ユーザーへの手動インストール要求を**徹底的に排除**
- **世界公開対応**: Node.js・VOICEVOX・Remotion全て自動インストール
- **Zero-Interaction**: `start_app.bat` をダブルクリックするだけで全環境が整う

---

## 2. 技術スタック

| レイヤー | 技術 | 用途 |
|---------|------|------|
| ランタイム | Node.js 20 LTS | 自動検出＆インストール |
| 動画エンジン | Remotion 4.x | 9:16縦型MP4レンダリング |
| 音声合成 | VOICEVOX Engine (ポータブル版) | キャラ別音声生成 |
| AI/OCR | Google Gemini API | Vision OCR＆キャスティング (将来拡張) |
| 画像処理 | sharp / Canvas | コマ分割・Ken Burnsエフェクト |
| オーケストレーション | run_pipeline.js | 一気通貫パイプライン |

---

## 3. ディレクトリ構成

```
short_movie/
├── start_app.bat              # ユーザーがダブルクリックするエントリポイント
├── scripts/
│   ├── bootstrap.ps1          # 完全自動環境構築（Node/VOICEVOX/npm install）
│   ├── check_node.ps1         # Node.js 検出＆自動インストール
│   └── check_voicevox.ps1     # VOICEVOX ポータブル版 自動DL＆起動
├── bin/
│   └── voicevox/              # ポータブルVOICEVOX Engine 自動展開先
├── input/                     # ユーザーが漫画画像+JSONをドロップする場所
│   ├── sample/                # サンプルデータ（デモ用）
│   └── README.txt             # 「ここにファイルを置いてください」
├── src/
│   ├── index.ts               # Remotion エントリポイント
│   ├── Root.tsx               # Remotion Root コンポーネント
│   ├── compositions/
│   │   └── VoiceComic.tsx     # メイン動画コンポジション
│   ├── components/
│   │   ├── ComicPanel.tsx     # コマ表示 + Ken Burns
│   │   ├── Subtitle.tsx       # 字幕オーバーレイ
│   │   └── Transition.tsx     # コマ間トランジション
│   ├── data/
│   │   └── scriptData.json    # パース済みスクリプトデータ (自動生成)
│   ├── lib/
│   │   ├── parse-metadata.ts  # metadata.json パーサー
│   │   ├── slice-panels.ts    # 4コマ画像→個別コマ分割
│   │   ├── voicevox-client.ts # VOICEVOX REST API クライアント
│   │   └── cast-voices.ts     # キャラクター→Voice ID マッピング
│   └── styles/
│       └── global.css         # グローバルスタイル
├── generate-voiceover.ts      # VOICEVOX音声一括生成スクリプト
├── run_pipeline.js            # 統合パイプラインオーケストレーター
├── public/
│   ├── voiceover/             # 生成音声ファイル (.wav)
│   ├── panels/                # 分割済みコマ画像
│   └── se/                    # 効果音
├── out/                       # 最終出力MP4
├── package.json
├── tsconfig.json
├── remotion.config.ts
├── .env.example
├── .gitignore
├── AGENTS.md
├── HANDOFF.md
├── README.md
└── docs/
    └── implementation_plan.md  # (このファイル)
```

---

## 4. 自動セットアップ・フロー

### start_app.bat → bootstrap.ps1 の流れ

1. **Node.js 検出**: `node --version` で存在確認
   - 未インストール → winget で Node.js 20 LTS を自動インストール
   - winget不可 → 直接MSIダウンロード＆サイレントインストール
2. **npm install**: `node_modules` 未存在 → `npm install` 自動実行
   - Remotion含む全依存関係がここで自動インストールされる
3. **VOICEVOX Engine**:
   - `bin/voicevox/run.exe` 存在確認
   - 未展開 → GitHub Releases からポータブル版ZIPを自動DL＆展開
   - ヘルスチェック (`http://127.0.0.1:50021/version`)
   - 未起動 → サイレント起動 (ウィンドウ非表示)
4. **パイプライン実行**: `node run_pipeline.js`

---

## 5. フェーズ別開発計画

### Phase 0: 骨格構築 (現在)
- [x] ディレクトリ構成設計
- [ ] `package.json` 作成（Remotion + 依存関係）
- [ ] `tsconfig.json` / `remotion.config.ts` 作成
- [ ] `.gitignore` / `.env.example` 作成
- [ ] `start_app.bat` 作成
- [ ] `scripts/bootstrap.ps1` 作成

### Phase 1: VOICEVOX 自動セットアップ
- [ ] `scripts/check_voicevox.ps1` - ポータブル版の自動DL＆展開
- [ ] VOICEVOXエンジンのサイレント起動ロジック
- [ ] ヘルスチェック
- [ ] キャラクター→Voice IDマッピングテーブル

### Phase 2: 漫画パーサー＆音声合成
- [ ] `src/lib/parse-metadata.ts` - Nano Banana Pro JSON読み込み
- [ ] `src/lib/slice-panels.ts` - 4コマ画像を個別コマに分割
- [ ] `src/lib/voicevox-client.ts` - VOICEVOX REST APIラッパー
- [ ] `src/lib/cast-voices.ts` - 話者属性→Voice ID自動キャスティング
- [ ] `generate-voiceover.ts` - 音声一括生成

### Phase 3: Remotion コンポジション
- [ ] `src/compositions/VoiceComic.tsx` - メインコンポジション (9:16, 1080x1920)
- [ ] `src/components/ComicPanel.tsx` - Ken Burnsエフェクト付きコマ表示
- [ ] `src/components/Subtitle.tsx` - リッチ字幕オーバーレイ
- [ ] `src/components/Transition.tsx` - コマ間トランジション

### Phase 4: 統合パイプライン
- [ ] `run_pipeline.js` - 全工程一気通貫実行
- [ ] エラーハンドリング＆リトライロジック

### Phase 5: ポリッシュ＆世界公開準備
- [ ] サンプルデータ同梱
- [ ] README.md（英語/日本語併記）
- [ ] LICENSE
- [ ] GitHub Release＆ZIP配布

---

## 6. VOICEVOX ポータブル版 仕様

| 項目 | 値 |
|------|-----|
| ダウンロードURL | `https://github.com/VOICEVOX/voicevox_engine/releases/` |
| 展開先 | `bin/voicevox/` |
| 起動コマンド | `bin/voicevox/run.exe --host 127.0.0.1 --port 50021` |
| ヘルスチェック | `GET http://127.0.0.1:50021/version` |
| キャラ例 | 春日部つむぎ (ID: 8), 九州そら (ID: 16), ずんだもん (ID: 3) |

---

## 7. remotion_video_2 からの継承事項

既存プロジェクトから以下のパターンを継承：

- **BOM自動除去** - Windows環境での `package.json` BOM問題対策
- **ロックファイル** - 二重実行防止
- **カスケードタイムアウト** - パイプライン全体/各ステージの安全装置
- **VOICEVOX ヘルスチェック＆自動起動** - エンジン稼働確認
- **UTF-8強制** - Windows環境での文字化け防止
- **出力タイムスタンプ命名** - `voice_comic_YYYYMMDDHHMMSS.mp4`
- **完了後自動再生** - `start ""` でのメディアプレイヤー起動

### 新規追加（世界公開対応）
- **Node.js 自動インストール** - winget / 直接DL
- **npm install 自動実行** - node_modules未存在時
- **VOICEVOX ポータブル版自動DL** - GitHub Releasesから取得
- **Remotion自動セットアップ** - npm install に含まれる（追加設定不要）
