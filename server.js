/**
 * AI Voice Comic Maker - バックエンドサーバー
 * 
 * 正式仕様:
 * 漫画画像をアップロードするだけ → Gemini Vision OCR で全自動解析
 * → VOICEVOX音声合成 → 動画データ返却
 * 
 * JSONは一切不要。全てAIが判断する。
 * 
 * API:
 * - POST /api/upload           : 漫画画像のみアップロード
 * - POST /api/analyze/:id      : Gemini Vision OCR で漫画解析
 * - POST /api/generate/:id     : 音声合成＆動画生成
 * - GET  /api/video/:id        : 生成済み動画の配信
 * - GET  /api/voicevox/status  : VOICEVOX接続確認
 * - GET  /api/gemini/status    : Gemini APIキー設定状態
 * - POST /api/gemini/key       : Gemini APIキーを設定
 */

import express from 'express';
import cors from 'cors';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import sharp from 'sharp';
import { bundle } from '@remotion/bundler';
import { renderMedia, selectComposition } from '@remotion/renderer';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const PORT = 3001;

// ミドルウェア
app.use(cors());
app.use(express.json());

// ── ガベージコレクション (古い一時ファイルの自動削除) ──
const CLEANUP_DIRS = [
  path.join(__dirname, 'temp'),
  path.join(__dirname, 'out'),
  path.join(__dirname, 'public', 'panels'),
  path.join(__dirname, 'public', 'audio')
];
const MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24時間

function cleanupOldFiles() {
  console.log('🧹 [Garbage Collection] 24時間以上経過した古い一時ファイルをチェック中...');
  const now = Date.now();
  let deletedCount = 0;

  CLEANUP_DIRS.forEach(dir => {
    if (!fs.existsSync(dir)) return;
    try {
      const items = fs.readdirSync(dir);
      items.forEach(item => {
        if (item === '.gitkeep') return;
        const itemPath = path.join(dir, item);
        const stats = fs.statSync(itemPath);
        if (now - stats.mtimeMs > MAX_AGE_MS) {
          if (stats.isDirectory()) {
            fs.rmSync(itemPath, { recursive: true, force: true });
          } else {
            fs.unlinkSync(itemPath);
          }
          deletedCount++;
        }
      });
    } catch (err) {
      console.error(`  ❌ ${dir} のクリーンアップ中にエラー:`, err.message);
    }
  });

  if (deletedCount > 0) {
    console.log(`  ✨ お掃除完了！ ${deletedCount} 件の古い一時データ（動画/画像/音声）を削除し、容量を空けました。`);
  } else {
    console.log('  ✨ 削除対象の古いファイルはありませんでした（クリーンです）。');
  }
}

// サーバー起動時にお掃除を実行
cleanupOldFiles();
// 以降、1時間ごとに自動実行
setInterval(cleanupOldFiles, 60 * 60 * 1000);

// セッション管理用（インメモリ）
const sessions = new Map();

// セッションごとのログ蓄積（フロントエンドポーリング用）
const sessionLogs = new Map();
function sessionLog(sessionId, message) {
  console.log(`[BE] ${message}`);
  if (!sessionLogs.has(sessionId)) sessionLogs.set(sessionId, []);
  sessionLogs.get(sessionId).push(message);
}

// 完了/エラー後のセッションログを5分後に自動削除（メモリリーク防止）
function scheduleLogCleanup(sessionId) {
  setTimeout(() => {
    sessionLogs.delete(sessionId);
    console.log(`🧹 [LogCleanup] セッション ${sessionId} のログを削除`);
  }, 5 * 60 * 1000);
}

// ランタイムで設定されたAPIキー（.envより優先）
let runtimeApiKey = '';
let runtimeModel = 'gemini-2.5-flash';

// ファイルアップロード設定（画像のみ）
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const sessionId = `session_${Date.now()}`;
    const dir = path.join(__dirname, 'temp', sessionId);
    fs.mkdirSync(dir, { recursive: true });
    req.sessionId = sessionId;
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    cb(null, file.originalname);
  },
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    // 画像ファイルのみ許可
    if (/\.(png|jpg|jpeg|webp)$/i.test(file.originalname)) {
      cb(null, true);
    } else {
      cb(new Error('画像ファイル (.png/.jpg/.webp) のみアップロード可能です'));
    }
  },
});

// ──────────────────────────────────────
// API: Gemini APIキー設定状態
// ──────────────────────────────────────
app.get('/api/gemini/status', (req, res) => {
  const key = runtimeApiKey || process.env.GEMINI_API_KEY || '';
  const configured = key.length > 0 && key !== 'your_gemini_api_key_here';
  res.json({ configured });
});

// ──────────────────────────────────────
// API: セッションログ取得（フロントエンドポーリング用）
// ──────────────────────────────────────
app.get('/api/logs/:sessionId', (req, res) => {
  const { sessionId } = req.params;
  const sinceIndex = parseInt(req.query.sinceIndex || '0', 10);
  const logs = sessionLogs.get(sessionId) || [];
  const newLogs = logs.slice(sinceIndex);
  res.json({ logs: newLogs, nextIndex: logs.length });
});

// ──────────────────────────────────────
// API: Gemini APIキーを設定
// ──────────────────────────────────────
app.post('/api/gemini/key', async (req, res) => {
  const { apiKey } = req.body;
  if (!apiKey || !apiKey.trim()) {
    return res.status(400).json({ valid: false, error: 'APIキーが空です' });
  }

  // 簡易バリデーション: Gemini APIにリクエストして確認
  try {
    const { GoogleGenerativeAI } = await import('@google/generative-ai');
    const genAI = new GoogleGenerativeAI(apiKey.trim());
    
    const modelsToTry = [
      'gemini-2.5-flash',
      'gemini-2.5-pro',
      'gemini-2.0-flash',
    ];
    
    let workingModel = null;
    let lastError = null;

    for (const modelName of modelsToTry) {
      try {
        const model = genAI.getGenerativeModel({ model: modelName });
        await model.generateContent('test');
        workingModel = modelName;
        break; // 成功したらループを抜ける
      } catch (e) {
        lastError = e;
        console.log(`    ℹ️ ${modelName} は利用不可: ${e.message.split('\\n')[0]}`);
      }
    }

    if (!workingModel) {
      throw lastError || new Error("利用可能なモデルが見つかりませんでした");
    }
    
    runtimeApiKey = apiKey.trim();
    runtimeModel = workingModel;
    console.log(`🔑 Gemini API Key が設定されました (使用モデル: ${runtimeModel})`);
    res.json({ valid: true });
  } catch (err) {
    console.error('❌ Gemini API Key 検証失敗:', err.message);
    res.json({ valid: false, error: 'APIキーが無効、または利用可能なモデルがありません' });
  }
});

// ──────────────────────────────────────
// API: VOICEVOX 接続確認
// ──────────────────────────────────────
app.get('/api/voicevox/status', async (req, res) => {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);

    const response = await fetch('http://127.0.0.1:50021/version', {
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (response.ok) {
      const version = await response.text();
      res.json({ connected: true, version: version.replace(/"/g, '') });
    } else {
      res.json({ connected: false });
    }
  } catch {
    res.json({ connected: false });
  }
});

// ──────────────────────────────────────
// API: VOICEVOXキャラクター一覧
// ──────────────────────────────────────
app.get('/api/voicevox/speakers', async (req, res) => {
  try {
    const response = await fetch('http://127.0.0.1:50021/speakers');
    if (response.ok) {
      const speakers = await response.json();
      res.json(speakers);
    } else {
      res.status(502).json({ error: 'VOICEVOX応答エラー' });
    }
  } catch {
    res.status(503).json({ error: 'VOICEVOX接続不可' });
  }
});

// ──────────────────────────────────────
// API: 画像のみアップロード（JSONは不要！）
// ──────────────────────────────────────
app.post('/api/upload', upload.single('image'), (req, res) => {
  try {
    const sessionId = req.sessionId || `session_${Date.now()}`;
    const imageFile = req.file;

    if (!imageFile) {
      return res.status(400).json({ error: '画像ファイルが必要です' });
    }

    sessions.set(sessionId, {
      imagePath: imageFile.path,
      status: 'uploaded',
      createdAt: Date.now(),
    });

    sessionLog(sessionId, `📂 [Upload] セッション作成完了`);
    sessionLog(sessionId, `📷 画像: ${imageFile.originalname}`);

    res.json({ sessionId });
  } catch (err) {
    console.error('❌ Upload error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ──────────────────────────────────────
// API: Gemini Vision OCR で漫画を解析
// ──────────────────────────────────────
app.post('/api/analyze/:sessionId', async (req, res) => {
  const { sessionId } = req.params;
  const session = sessions.get(sessionId);

  if (!session) {
    return res.status(404).json({ error: 'セッションが見つかりません' });
  }

  try {
    sessionLog(sessionId, `🔍 [Analyze] Gemini Vision OCR 開始...`);
    sessionLog(sessionId, `🧠 統合解析エンジン起動: 画像構造 / セリフ抽出 / 感情推定 の並列タスクを構築中...`);
    session.status = 'analyzing';

    const apiKey = runtimeApiKey || process.env.GEMINI_API_KEY;
    let metadata;

    if (!apiKey || apiKey === 'your_gemini_api_key_here') {
      console.log('    ⚠️ Gemini API Key が設定されていません。モックデータ(input/sample/metadata.json)を使用します。');
      const mockPath = path.join(__dirname, 'input', 'sample', 'metadata.json');
      if (fs.existsSync(mockPath)) {
        metadata = JSON.parse(fs.readFileSync(mockPath, 'utf8'));
      } else {
        return res.status(400).json({ error: 'Gemini API Keyが設定されておらず、モックデータも見つかりません' });
      }
    } else {
      // Gemini OCR モジュールを動的インポート
      const { GoogleGenerativeAI } = await import('@google/generative-ai');
      const genAI = new GoogleGenerativeAI(apiKey);
      
      // 動的に判定したモデルを使用（画像入力非対応のgemini-proなどが選ばれた場合のフォールバックも考慮）
      let modelToUse = runtimeModel;
      const model = genAI.getGenerativeModel({ model: modelToUse });

      // 画像をBase64に変換
      const imageBuffer = fs.readFileSync(session.imagePath);
      const base64Image = imageBuffer.toString('base64');
      const ext = path.extname(session.imagePath).toLowerCase();
      const mimeMap = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
      const mimeType = mimeMap[ext] || 'image/png';

      // OCRプロンプト
      const prompt = `あなたは漫画解析AIです。この漫画画像を詳細に分析してください。
【前提条件】
・この画像は「縦並びの4コマ漫画（A4縦サイズ）」です。一番上にはタイトル、一番下にはフッターがあります。
・画像生成AIによって描かれているため、コマごとに同じキャラクターでも服や髪型に若干のブレ（非一貫性）がある場合があります。髪色やメガネなどの「特徴」から同一人物を特定してください。

## タスク
1. この漫画画像に含まれるコマ（パネル）を上から順に識別する（一般的な4コマ漫画の場合は必ず4つのコマオブジェクトを出力すること）
2. 各コマ内のセリフ（吹き出しのテキスト）を読み取る
3. 各セリフの話者を判定する（キャラクターの外見・位置から推定）
4. 各セリフの感情を推定する
5. セリフ（吹き出し）がコマ内のどの位置にあるか（left, center, right）を推定する。※重要：日本の漫画は「右から左」に読みます。そのため最初のセリフは通常「右（right）」にあります。見た目上の左右を正確に判定してください。
6. 漫画全体のタイトルを決定する:
   - 画像内にタイトルテキストが明確に存在する場合 → そのテキストをそのまま使用
   - 画像内にタイトルがない場合 → 漫画の内容・オチ・テーマから、SNS投稿に適した魅力的で簡潔な日本語タイトルを創作する（例: 「お弁当の秘密」「猫と掃除機」等）

## 出力形式
以下のJSON形式のみを出力してください。マークダウンのコードブロックは使わないでください。

{
  "title": "漫画のタイトル",
  "panels": [
    {
      "panelNumber": 1,
      "dialogues": [
        {
          "speaker": "キャラ名（推定）",
          "gender": "male または female または unknown",
          "age": "child または young または adult または elder",
          "personality": "cool または cute または energetic または calm または serious",
          "bubblePosition": "left または center または right",
          "text": "セリフの内容",
          "emotion": "感情"
        }
      ]
    }
  ]
}

## ルール
- **titleフィールドは必須**: 空文字列にしないこと。必ず意味のある日本語タイトルを設定すること
- セリフは吹き出し内のテキストを正確に読み取ること
- 話者名はキャラクターの外見的特徴から分かりやすい名前を付けること（例: 「青髪の少女」「メガネの男性」等）
- 同じキャラクターには一貫した名前を使うこと
- ナレーション（吹き出し外のテキスト）は speaker を "ナレーション" にすること
- コマは上から下、左から右の順に番号を振ること
- 効果音やオノマトペはスキップ（セリフのみ抽出）
- 感情は neutral/happy/sad/angry/surprised/excited/worried 等から選択
- personalityはキャラクターの見た目や雰囲気から推定すること（cool=クール・無表情・知的, cute=可愛い・幼い, energetic=元気・活発, calm=穏やか・おっとり, serious=真面目・厳格）`;

      const result = await model.generateContent([
        prompt,
        { inlineData: { mimeType, data: base64Image } },
      ]);

      const responseText = result.response.text();
      sessionLog(sessionId, `📝 Gemini レスポンス受信 (${responseText.length}文字)`);
      sessionLog(sessionId, `🔬 [Parser] JSONペイロードを抽出中... コードフェンス検出 & サニタイズ処理`);

      // JSONパース（Geminiの不正JSON出力に対応するサニタイズ処理付き）
      function sanitizeJson(raw) {
        let s = raw.trim();
        // コードフェンスを除去
        if (s.startsWith('```')) {
          s = s.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
        }
        // トレイリングカンマを除去 (配列・オブジェクト末尾の ,] や ,} )
        s = s.replace(/,\s*([}\]])/g, '$1');
        // 制御文字を除去（改行・タブ以外）
        s = s.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');
        return s;
      }

      let cleaned = sanitizeJson(responseText);
      try {
        metadata = JSON.parse(cleaned);
      } catch (parseErr1) {
        sessionLog(sessionId, `⚠️ [Parser] 1次パース失敗: ${parseErr1.message}`);
        // フォールバック: JSON部分だけを抽出して再トライ
        const jsonMatch = responseText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          try {
            metadata = JSON.parse(sanitizeJson(jsonMatch[0]));
          } catch (parseErr2) {
            sessionLog(sessionId, `❌ [Parser] 2次パースも失敗: ${parseErr2.message}`);
            throw new Error('AIの応答からメタデータを抽出できませんでした。再度お試しください。');
          }
        } else {
          throw new Error('AIの応答からメタデータを抽出できませんでした。再度お試しください。');
        }
      }
    }

    // 構造を正規化しつつ、キャラごとの声の重複を防ぐ（性格ベースキャスティング v2）
    const characterVoiceMap = new Map();
    const usedVoiceIds = new Set();

    // 性格×性別ベースのボイスプール定義
    // 女性: cool→落ち着いた声, cute→可愛い声, energetic→元気な声, calm→穏やかな声, serious→知的な声
    // 男性: cool/serious→渋い声, energetic→若い声, calm→穏やかな声
    const VOICE_POOLS = {
      female: {
        cool:      [10, 16, 14],    // 雨晴はう, 九州そら, 冥鳴ひまり
        cute:      [8, 2, 9],       // 春日部つむぎ, 四国めたん, 波音リツ
        energetic: [8, 9, 2],       // 春日部つむぎ, 波音リツ, 四国めたん
        calm:      [14, 16, 10],    // 冥鳴ひまり, 九州そら, 雨晴はう
        serious:   [10, 14, 16],    // 雨晴はう, 冥鳴ひまり, 九州そら
      },
      male: {
        cool:      [11, 13],        // 玄野武宏, 青山龍星
        cute:      [12, 13],        // 白上虎太郎, 青山龍星
        energetic: [12, 13],        // 白上虎太郎, 青山龍星
        calm:      [11, 13],        // 玄野武宏, 青山龍星
        serious:   [11, 13],        // 玄野武宏, 青山龍星
      },
      // デフォルト（gender不明時）
      unknown: {
        cool:      [10, 16, 11],
        cute:      [8, 2, 12],
        energetic: [8, 9, 12],
        calm:      [14, 16, 11],
        serious:   [10, 14, 11],
      },
    };

    // ナレーション判定用パターン
    const narratorPatterns = ['ナレ', 'narr', '語り手', '地の文', 'ナレーター', 'ナレータ'];

    metadata = {
      title: metadata.title || '無題の漫画',
      panels: (metadata.panels || []).map((p, i) => ({
        panelNumber: p.panelNumber || i + 1,
        dialogues: (p.dialogues || []).map(d => {
          const gender = d.gender || 'unknown';
          const age = d.age || 'young';
          const personality = d.personality || 'calm';
          const speaker = d.speaker || '不明';

          // ナレーション判定
          const isNarrator = narratorPatterns.some(pat => speaker.toLowerCase().includes(pat.toLowerCase()));

          let voiceId;
          if (characterVoiceMap.has(speaker)) {
            voiceId = characterVoiceMap.get(speaker);
          } else {
            if (isNarrator) {
              voiceId = 2; // 四国めたんノーマル（ナレーション専用）
            } else {
              // 性格×性別からプールを選択
              const genderKey = VOICE_POOLS[gender] ? gender : 'unknown';
              const pool = VOICE_POOLS[genderKey][personality] || VOICE_POOLS[genderKey].calm;

              // 子供キャラは特別扱い: 男児→白上虎太郎, 女児→春日部つむぎ
              let finalPool = pool;
              if (age === 'child') {
                finalPool = gender === 'male' ? [12] : [8];
              }

              // 未使用の声を優先して重複を回避
              const unusedPool = finalPool.filter(id => !usedVoiceIds.has(id));
              const selectFrom = unusedPool.length > 0 ? unusedPool : finalPool;
              const hash = [...speaker].reduce((h, c) => h + c.charCodeAt(0), 0);
              voiceId = selectFrom[hash % selectFrom.length];
            }

            characterVoiceMap.set(speaker, voiceId);
            usedVoiceIds.add(voiceId);

            sessionLog(sessionId, `🎭 [Casting v2] 検出話者: ${speaker} (${gender}, ${age}, ${personality})`);
            sessionLog(sessionId, `   ↳ 性格プロファイル "${personality}" からボイスプールを選択`);
            sessionLog(sessionId, `   ↳ 重複回避アルゴリズム適用 -> VOICEVOX ID: ${voiceId} をアサイン`);
          }

          return {
            speaker,
            gender,
            age,
            personality,
            bubblePosition: d.bubblePosition || 'center',
            text: d.text || '',
            emotion: d.emotion || 'neutral',
            voiceId
          };
        }),
      })),
    };
    // ── 日本の漫画読み順を強制適用: 各コマ内のセリフを右→中→左にソート ──
    const positionOrder = { right: 0, center: 1, left: 2 };
    for (const panel of metadata.panels) {
      const before = panel.dialogues.map(d => `${d.speaker}(${d.bubblePosition})`).join(' → ');
      panel.dialogues.sort((a, b) => {
        const orderA = positionOrder[a.bubblePosition] ?? 1;
        const orderB = positionOrder[b.bubblePosition] ?? 1;
        return orderA - orderB;
      });
      const after = panel.dialogues.map(d => `${d.speaker}(${d.bubblePosition})`).join(' → ');
      if (before !== after) {
        sessionLog(sessionId, `📖 [Reading Order] コマ${panel.panelNumber}: セリフ順を右→左に修正`);
        sessionLog(sessionId, `   ↳ ${after}`);
      }
    }

    // セッションにメタデータを保存
    session.metadata = metadata;
    session.status = 'analyzed';

    // 感情に基づくBGMの動的生成（プロシージャル作曲エンジン）
    try {
      const { execSync } = await import('child_process');
      const emotionCounts = { happy: 0, excited: 0, sad: 0, worried: 0, angry: 0, neutral: 0, surprised: 0 };
      for (const panel of metadata.panels) {
        for (const d of panel.dialogues) {
          if (emotionCounts[d.emotion] !== undefined) emotionCounts[d.emotion]++;
          else emotionCounts.neutral++;
        }
      }
      const dominantEmotion = Object.keys(emotionCounts).reduce((a, b) => emotionCounts[a] > emotionCounts[b] ? a : b);
      const bgmSeed = Date.now();
      sessionLog(sessionId, `🎵 [BGM Engine] Dominant Emotion: ${dominantEmotion} (Seed: ${bgmSeed})`);
      
      const stdout = execSync(`node generate_bgm.js ${dominantEmotion} ${bgmSeed}`, { cwd: process.cwd() });
      const bgmLogs = stdout.toString().split('\n').filter(line => line.trim());
      bgmLogs.forEach(log => sessionLog(sessionId, log));
    } catch (e) {
      console.error('BGMの生成に失敗しました:', e);
    }

    const totalDialogues = metadata.panels.reduce((s, p) => s + p.dialogues.length, 0);
    const speakers = [...new Set(metadata.panels.flatMap(p => p.dialogues.map(d => d.speaker)))];

    sessionLog(sessionId, `✅ OCR完了: "${metadata.title}"`);
    sessionLog(sessionId, `コマ数: ${metadata.panels.length}, セリフ数: ${totalDialogues}`);
    sessionLog(sessionId, `話者: ${speakers.join(', ')}`);

    res.json({ metadata });

  } catch (err) {
    console.error('❌ Analyze error:', err);
    session.status = 'error';
    res.status(500).json({ error: err.message });
  }
});

// ──────────────────────────────────────
// API: 音声合成＆動画生成
// ──────────────────────────────────────
app.post('/api/generate/:sessionId', async (req, res) => {
  const { sessionId } = req.params;
  const session = sessions.get(sessionId);

  if (!session) {
    return res.status(404).json({ error: 'セッションが見つかりません' });
  }

  if (!session.metadata) {
    return res.status(400).json({ error: 'まずAI解析を実行してください' });
  }

  try {
    sessionLog(sessionId, `🎬 [Generate] 動画生成を開始...`);
    session.status = 'generating';

    const metadata = session.metadata;
    const title = metadata.title;
    const dialogues = [];

    for (const panel of metadata.panels) {
      for (const d of panel.dialogues || []) {
        dialogues.push({
          speaker: d.speaker,
          gender: d.gender,
          age: d.age,
          voiceId: d.voiceId,
          bubblePosition: d.bubblePosition || 'center',
          text: d.text,
          emotion: d.emotion,
          panelIndex: (panel.panelNumber || 1) - 1,
        });
      }
    }

    sessionLog(sessionId, `📖 タイトル: ${title}`);
    sessionLog(sessionId, `💬 セリフ数: ${dialogues.length}`);

    // ── 画像分割 (sharp) ──
    sessionLog(sessionId, '✂️ [Sharp] 画像をコマごとに分割中...');
    const publicPanelsDir = path.join(__dirname, 'public', 'panels');
    if (!fs.existsSync(publicPanelsDir)) fs.mkdirSync(publicPanelsDir, { recursive: true });

    const metadataImg = await sharp(session.imagePath).metadata();
    const width = metadataImg.width;
    const height = metadataImg.height;
    sessionLog(sessionId, `📐 [Sharp] 原画解析: ${width}×${height}px (${(width * height / 1000000).toFixed(1)}MP)`);

    const panelCount = Math.max(1, metadata.panels.length);
    const panelPaths = [];
    const aspectRatio = width / height;
    
    let layout = 'grid';
    // A4縦 (約0.707) も縦割り (vertical) と判定させるため、閾値を0.9に緩和
    if (aspectRatio < 0.9) layout = 'vertical';
    else if (aspectRatio > 1.5) layout = 'horizontal';
    sessionLog(sessionId, `📐 [Sharp] レイアウト判定: ${layout} (aspect: ${aspectRatio.toFixed(3)}) → ${panelCount}コマ分割`);

    for (let i = 0; i < panelCount; i++) {
      let extractRegion;
      switch (layout) {
        case 'vertical': {
          // ユーザー専用フォーマット（Super FURU AI 4-koma等）の最適化
          // 上部のタイトル領域（約6%）と下部のフッター領域（約3%）を除外し、純粋なコマ部分のみを等分する
          const topMargin = Math.floor(height * 0.065);
          const bottomMargin = Math.floor(height * 0.035);
          const contentHeight = height - topMargin - bottomMargin;
          const panelHeight = Math.floor(contentHeight / panelCount);
          
          extractRegion = {
            left: 0, top: topMargin + (panelHeight * i), width: width,
            height: i < panelCount - 1 ? panelHeight : contentHeight - panelHeight * i,
          };
          break;
        }
        case 'horizontal': {
          const panelWidth = Math.floor(width / panelCount);
          extractRegion = {
            left: panelWidth * i, top: 0,
            width: i < panelCount - 1 ? panelWidth : width - panelWidth * i,
            height: height,
          };
          break;
        }
        case 'grid': {
          const cols = 2; const rows = 2;
          const panelWidth = Math.floor(width / cols);
          const panelHeight = Math.floor(height / rows);
          
          // 日本の漫画（右から左）のZパターンの読む順序（右上→左上→右下→左下）
          const readingOrder = [
            { col: 1, row: 0 }, // i=0 (右上)
            { col: 0, row: 0 }, // i=1 (左上)
            { col: 1, row: 1 }, // i=2 (右下)
            { col: 0, row: 1 }, // i=3 (左下)
          ];
          
          const targetIndex = i < 4 ? i : 3;
          const col = readingOrder[targetIndex].col;
          const row = readingOrder[targetIndex].row;

          extractRegion = {
            left: panelWidth * col, top: panelHeight * row,
            width: col < cols - 1 ? panelWidth : width - panelWidth * col,
            height: row < rows - 1 ? panelHeight : height - panelHeight * row,
          };
          break;
        }
      }

      const outputFileName = `${sessionId}_panel_${i + 1}.png`;
      const outputPath = path.join(publicPanelsDir, outputFileName);
      await sharp(session.imagePath).extract(extractRegion).png({ quality: 95 }).toFile(outputPath);
      panelPaths.push(`panels/${outputFileName}`);
    }
    sessionLog(sessionId, `✅ ${panelCount}コマに分割完了 (${layout})`);

    // アウトロ用にオリジナル画像全体もコピー
    const originalImageName = `${sessionId}_full.png`;
    const originalImagePath = path.join(publicPanelsDir, originalImageName);
    fs.copyFileSync(session.imagePath, originalImagePath);
    const originalImagePublicPath = `panels/${originalImageName}`;

    // ── VOICEVOX 音声合成 ──
    sessionLog(sessionId, '🎙️ [VOICEVOX] 音声合成パイプラインを起動...');
    sessionLog(sessionId, `   ↳ 合成対象: ${dialogues.length}セリフ + タイトルコール`);
    const publicVoiceDir = path.join(__dirname, 'public', 'voiceover', sessionId);
    if (!fs.existsSync(publicVoiceDir)) fs.mkdirSync(publicVoiceDir, { recursive: true });

    const audioFiles = [];
    for (let i = 0; i < dialogues.length; i++) {
      const d = dialogues[i];
      const speakerId = getSpeakerId(d);
      const filename = `line_${String(i + 1).padStart(2, '0')}.wav`;
      const filepath = path.join(publicVoiceDir, filename);

      const displayText = d.text.length > 25 ? d.text.substring(0, 25) + '...' : d.text;
      sessionLog(sessionId, `🎤 [Casting] ${d.speaker} (${d.gender}, ${d.age}) → Voice ID: ${speakerId}`);
      sessionLog(sessionId, `  [${i + 1}/${dialogues.length}] "${displayText}"`);

      try {
        // audio_query
        const queryRes = await fetch(
          `http://127.0.0.1:50021/audio_query?text=${encodeURIComponent(d.text)}&speaker=${speakerId}`,
          { method: 'POST' }
        );
        const query = await queryRes.json();
        
        // ── 感情表現エンジン v2: pitch / intonation / volume で感情を表現 ──
        const EMOTION_PROFILES = {
          angry:     { pitchScale: -0.03, intonationScale: 1.5, volumeScale: 1.2 },
          sad:       { pitchScale: -0.05, intonationScale: 0.6, volumeScale: 0.85 },
          worried:   { pitchScale: 0.0,   intonationScale: 0.7, volumeScale: 0.9 },
          happy:     { pitchScale: 0.04,  intonationScale: 1.4, volumeScale: 1.1 },
          excited:   { pitchScale: 0.05,  intonationScale: 1.6, volumeScale: 1.15 },
          surprised: { pitchScale: 0.06,  intonationScale: 1.7, volumeScale: 1.1 },
          neutral:   { pitchScale: 0.0,   intonationScale: 1.0, volumeScale: 1.0 },
        };
        const profile = EMOTION_PROFILES[d.emotion] || EMOTION_PROFILES.neutral;

        // ── 速度正規化エンジン: モーラデータから実効速度を統一 ──
        // VOICEVOXの各モデルは固有の発話速度を持つため、speedScale固定では速度差が生じる
        // audio_queryが返すモーラの合計時間から実際の発話時間を計算し、
        // 目標速度（1文字あたり0.15秒 ≒ 約6.6文字/秒。ほんの少しだけ遅く微調整）
        const TARGET_SEC_PER_CHAR = 0.15;
        let totalMoraDuration = 0;
        for (const phrase of (query.accent_phrases || [])) {
          for (const mora of (phrase.moras || [])) {
            totalMoraDuration += (mora.vowel_length || 0) + (mora.consonant_length || 0);
          }
          if (phrase.pause_mora) {
            totalMoraDuration += phrase.pause_mora.vowel_length || 0;
          }
        }
        const textLength = d.text.replace(/[、。！？…\s]/g, '').length || 1;
        const targetDuration = textLength * TARGET_SEC_PER_CHAR;
        const normalizedSpeed = totalMoraDuration > 0
          ? Math.max(0.85, Math.min(1.6, totalMoraDuration / targetDuration))
          : 1.25; // フォールバック

        query.speedScale = normalizedSpeed;
        query.pitchScale = profile.pitchScale;
        query.intonationScale = profile.intonationScale;
        query.volumeScale = profile.volumeScale;
        sessionLog(sessionId, `   🎚️ 速度正規化: モーラ=${totalMoraDuration.toFixed(2)}s / 文字数=${textLength} → spd=${normalizedSpeed.toFixed(2)}x | pitch=${profile.pitchScale} / inton=${profile.intonationScale} / vol=${profile.volumeScale}`);

        // synthesis
        const synthRes = await fetch(
          `http://127.0.0.1:50021/synthesis?speaker=${speakerId}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(query),
          }
        );
        const wavBuffer = Buffer.from(await synthRes.arrayBuffer());
        fs.writeFileSync(filepath, wavBuffer);

        // WAVからduration取得
        const durationSec = getWavDuration(wavBuffer);
        audioFiles.push({ filename, publicPath: `voiceover/${sessionId}/${filename}`, durationSec, dialogue: d });
        sessionLog(sessionId, `  ✅ ${durationSec.toFixed(2)}s → ${filename}`);
      } catch (err) {
        console.error(`      ❌ 音声生成失敗: ${err.message}`);
        audioFiles.push({ filename, publicPath: null, durationSec: 3, dialogue: d });
      }
    }

    const totalAudioSec = audioFiles.reduce((s, a) => s + a.durationSec, 0);
    sessionLog(sessionId, `✅ [VOICEVOX] セリフ音声合成完了: ${audioFiles.length}本 / 合計 ${totalAudioSec.toFixed(1)}秒`);

    // ── タイトルコール音声 ──
    sessionLog(sessionId, '📢 [Title Call] ずんだもん (ID:3) によるタイトルコール音声を合成中...');
    const titleAudioPath = path.join(publicVoiceDir, 'title_call.wav');
    let titleAudioPublicPath = null;
    try {
      const titleQueryRes = await fetch(
        `http://127.0.0.1:50021/audio_query?text=${encodeURIComponent(title)}&speaker=3`,
        { method: 'POST' }
      );
      const titleQuery = await titleQueryRes.json();
      titleQuery.speedScale = 0.95;
      titleQuery.pitchScale = 0.05;

      const titleSynthRes = await fetch(
        `http://127.0.0.1:50021/synthesis?speaker=3`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(titleQuery),
        }
      );
      const titleWav = Buffer.from(await titleSynthRes.arrayBuffer());
      fs.writeFileSync(titleAudioPath, titleWav);
      titleAudioPublicPath = `voiceover/${sessionId}/title_call.wav`;
      const titleDurationSec = getWavDuration(titleWav);
      var titleDurationFrames = Math.ceil(titleDurationSec * 30) + 15;
      sessionLog(sessionId, `✅ タイトルコール音声生成完了 (${titleDurationSec.toFixed(2)}s)`);
    } catch (err) {
      console.log(`    ⚠️ タイトルコール生成スキップ: ${err.message}`);
      var titleDurationFrames = 90; // フォールバック
    }

    sessionLog(sessionId, '🗂️ [Timeline] 動画タイムラインを構築中...');

    // セリフ末尾の句読点・感情に基づく動的パディング（間の長さ）
    function calcPadding(text, emotion) {
      const lastChar = text.slice(-1);
      if (lastChar === '…' || text.endsWith('...')) return 22; // 余韻が必要な沈黙
      if (lastChar === '。' || lastChar === '.') return 16;    // 通常の区切り
      if (lastChar === '！' || lastChar === '!') return 8;     // テンポよく
      if (lastChar === '？' || lastChar === '?') return 18;    // 問いかけの間
      if (emotion === 'sad' || emotion === 'worried') return 20; // 感情的な間
      if (emotion === 'angry' || emotion === 'excited') return 8; // 畳みかけ
      return 12; // デフォルト
    }

    const scriptData = {
      title,
      version: '1.2.9',
      panels: panelPaths, // 分割されたコマ画像パス
      originalImage: originalImagePublicPath, // 全体画像
      titleAudio: titleAudioPublicPath,
      titleDurationInFrames: titleDurationFrames,
      dialogues: audioFiles.map((af, i) => ({
        id: `line_${String(i + 1).padStart(2, '0')}`,
        speaker: af.dialogue.speaker,
        text: af.dialogue.text,
        panelIndex: af.dialogue.panelIndex,
        bubblePosition: af.dialogue.bubblePosition,
        durationInFrames: Math.ceil(af.durationSec * 30) + calcPadding(af.dialogue.text, af.dialogue.emotion),
        audioFile: af.publicPath,
      })),
    };
    scriptData.totalDurationInFrames = scriptData.dialogues.reduce(
      (sum, d) => sum + d.durationInFrames, 0
    ) + scriptData.titleDurationInFrames + 180; // タイトルカード余白 + アウトロ余白(180)

    const totalSec = (scriptData.totalDurationInFrames / 30).toFixed(1);
    sessionLog(sessionId, `   ↳ タイトルカード: ${titleDurationFrames}F | セリフ区間: ${scriptData.dialogues.reduce((s,d)=>s+d.durationInFrames,0)}F | アウトロ: 180F`);
    sessionLog(sessionId, `   ↳ 合計: ${scriptData.totalDurationInFrames}F (${totalSec}秒 @30fps)`);

    const scriptDataPath = path.join(__dirname, 'temp', sessionId, 'scriptData.json');
    fs.writeFileSync(scriptDataPath, JSON.stringify(scriptData, null, 2), 'utf8');
    sessionLog(sessionId, '   ↳ scriptData.json 書き出し完了');

    // 出力パス
    const outDir = path.join(__dirname, 'out');
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
    const outputPath = path.join(outDir, `voice_comic_${timestamp}.mp4`);

    // ── Remotion レンダリング ──
    sessionLog(sessionId, '🎬 [Remotion] 動画レンダリングパイプライン開始');
    const compositionId = 'VoiceComic';

    // Vite経由でバンドル
    sessionLog(sessionId, '📦 [Remotion] Webpack バンドル中... (TypeScript → JavaScript 変換)');
    const bundleStart = Date.now();
    const bundledPath = await bundle({
      entryPoint: path.join(__dirname, 'src', 'index.ts'),
      webpackOverride: (config) => config,
    });
    const bundleMs = Date.now() - bundleStart;
    sessionLog(sessionId, `   ↳ バンドル完了 (${(bundleMs / 1000).toFixed(1)}秒)`);

    sessionLog(sessionId, '🎥 [Remotion] コンポジション "VoiceComic" を抽出中...');
    const composition = await selectComposition({
      serveUrl: bundledPath,
      id: compositionId,
      inputProps: { scriptData },
    });

    // 動的に計算されたフレーム数をコンポジションに上書き設定
    composition.durationInFrames = scriptData.totalDurationInFrames;

    sessionLog(sessionId, `⏳ [Remotion] H.264エンコード開始: ${composition.durationInFrames}F / ${composition.width}×${composition.height} / 30fps`);
    let lastReportedPct = -1;
    await renderMedia({
      composition,
      serveUrl: bundledPath,
      codec: 'h264',
      outputLocation: outputPath,
      inputProps: { scriptData },
      onProgress: ({ renderedFrames }) => {
        const pct = Math.floor((renderedFrames / composition.durationInFrames) * 100);
        if (pct >= lastReportedPct + 5) {
          lastReportedPct = pct;
          sessionLog(sessionId, `🎞️ レンダリング進捗: ${pct}%`);
        }
      },
    });

    session.status = 'complete';
    session.videoPath = outputPath;
    session.scriptData = scriptData;

    // 出力ファイルサイズを取得
    const outputStats = fs.statSync(outputPath);
    const fileSizeMB = (outputStats.size / (1024 * 1024)).toFixed(2);
    sessionLog(sessionId, `✅ [Generate] エンコード完了! → ${fileSizeMB} MB`);
    sessionLog(sessionId, `🎉 ボイスコミック動画の生成が完了しました!`);
    scheduleLogCleanup(sessionId);
    res.json({ videoPath: outputPath, scriptData });

  } catch (err) {
    console.error('❌ Generation error:', err);
    session.status = 'error';
    scheduleLogCleanup(sessionId);
    res.status(500).json({ error: err.message });
  }
});

// ──────────────────────────────────────
// API: 生成済み動画の配信
// ──────────────────────────────────────
app.get('/api/video/:sessionId', (req, res) => {
  const session = sessions.get(req.params.sessionId);
  if (!session?.videoPath || !fs.existsSync(session.videoPath)) {
    return res.status(404).json({ error: '動画が見つかりません' });
  }
  res.sendFile(session.videoPath);
});

// ──────────────────────────────────────
// ヘルパー関数
// ──────────────────────────────────────

/**
 * 話者のvoiceIdを返す（Casting v2でアサイン済みのvoiceIdを優先）
 * ※analyze側で性格ベースキャスティングが完了しているため、通常はvoiceIdがそのまま返る
 * ※フォールバック: voiceIdが未設定の場合のみ簡易推定を行う
 */
function getSpeakerId(dialogue) {
  if (dialogue.voiceId) return dialogue.voiceId;

  const speaker = dialogue.speaker || '';
  const gender = dialogue.gender || 'unknown';

  // ナレーション判定（拡張パターン）
  const narratorPatterns = ['ナレ', 'narr', '語り手', '地の文', 'ナレーター', 'ナレータ'];
  if (narratorPatterns.some(pat => speaker.toLowerCase().includes(pat.toLowerCase()))) return 2;

  // フォールバック: 性別ベースの簡易アサイン
  const hash = [...speaker].reduce((h, c) => h + c.charCodeAt(0), 0);
  const pool = gender === 'male' ? [11, 13, 12] : [10, 14, 8, 2, 16];
  const fallbackId = pool[hash % pool.length];
  console.log(`    🎭 [Casting Fallback] ${speaker} (${gender}) → Voice ID: ${fallbackId}`);
  return fallbackId;
}

/**
 * WAVバッファからDuration(秒)を取得
 */
function getWavDuration(wavBuffer) {
  try {
    const byteRate = wavBuffer.readUInt32LE(28);
    let offset = 12;
    while (offset < wavBuffer.length - 8) {
      const chunkId = wavBuffer.toString('ascii', offset, offset + 4);
      const chunkSize = wavBuffer.readUInt32LE(offset + 4);
      if (chunkId === 'data') {
        return chunkSize / byteRate;
      }
      offset += 8 + chunkSize;
    }
    return (wavBuffer.length - 44) / byteRate;
  } catch {
    return 3; // フォールバック3秒
  }
}

// ──────────────────────────────────────
// サーバー起動
// ──────────────────────────────────────
app.listen(PORT, () => {
  console.log('');
  console.log('================================================');
  console.log(`  🚀 AI Voice Comic Maker Backend`);
  console.log(`  📡 http://localhost:${PORT}`);
  console.log('  📋 仕様: 画像ドロップのみ → AI全自動解析');
  console.log('================================================');
  console.log('');
});
