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
import { generateBgm } from './generate_bgm.js';
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

// ランタイムで設定されたAPIキー（.envより優先）
let runtimeApiKey = '';
let runtimeModel = 'gemini-1.5-flash';

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
      'gemini-1.5-flash',
      'gemini-1.5-pro',
      'gemini-2.0-flash',
      'gemini-2.5-flash',
      'gemini-2.5-pro'
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

    console.log(`📂 [Upload] セッション ${sessionId} 作成完了`);
    console.log(`   📷 画像: ${imageFile.originalname}`);

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
    console.log(`\n🔍 [Analyze] Gemini Vision OCR 開始: ${sessionId}`);
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
      if (modelToUse === 'gemini-pro') {
        modelToUse = 'gemini-pro-vision'; // 画像用
      }
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
6. 漫画全体のタイトルを推定する（画像内にタイトルがあればそれを使用、なければ内容から推定）

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
          "bubblePosition": "left または center または right",
          "text": "セリフの内容",
          "emotion": "感情"
        }
      ]
    }
  ]
}

## ルール
- セリフは吹き出し内のテキストを正確に読み取ること
- 話者名はキャラクターの外見的特徴から分かりやすい名前を付けること（例: 「青髪の少女」「メガネの男性」等）
- 同じキャラクターには一貫した名前を使うこと
- ナレーション（吹き出し外のテキスト）は speaker を "ナレーション" にすること
- コマは上から下、左から右の順に番号を振ること
- 効果音やオノマトペはスキップ（セリフのみ抽出）
- 感情は neutral/happy/sad/angry/surprised/excited/worried 等から選択`;

      const result = await model.generateContent([
        prompt,
        { inlineData: { mimeType, data: base64Image } },
      ]);

      const responseText = result.response.text();
      console.log(`  📝 Gemini レスポンス受信 (${responseText.length}文字)`);

      // JSONパース
      let cleaned = responseText.trim();
      if (cleaned.startsWith('```')) {
        cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
      }
      try {
        metadata = JSON.parse(cleaned);
      } catch {
        const jsonMatch = responseText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          metadata = JSON.parse(jsonMatch[0]);
        } else {
          throw new Error('AIの応答からメタデータを抽出できませんでした。再度お試しください。');
        }
      }
    }

    // 構造を正規化しつつ、キャラごとの声の重複を防ぐ
    const characterVoiceMap = new Map();
    const usedVoiceIds = new Set();
    
    metadata = {
      title: metadata.title || '無題の漫画',
      panels: (metadata.panels || []).map((p, i) => ({
        panelNumber: p.panelNumber || i + 1,
        dialogues: (p.dialogues || []).map(d => {
          const gender = d.gender || 'unknown';
          const age = d.age || 'young';
          const speaker = d.speaker || '不明';
          
          let voiceId;
          if (characterVoiceMap.has(speaker)) {
            voiceId = characterVoiceMap.get(speaker);
          } else {
            let pool = [8, 16, 2, 14, 10, 20, 9, 43, 22, 38];
            if (gender === 'female') {
              if (age === 'child') pool = [8, 16, 20, 43];
              else if (age === 'young') pool = [2, 14, 9, 43, 8];
              else pool = [10, 14, 2, 16];
            } else if (gender === 'male') {
              if (age === 'child' || age === 'young') pool = [1, 10, 22, 38];
              else pool = [13, 11, 15, 29];
            }
            
            // 未使用の声を優先
            const unusedPool = pool.filter(id => !usedVoiceIds.has(id));
            if (unusedPool.length > 0) {
              const hash = [...speaker].reduce((h, c) => h + c.charCodeAt(0), 0);
              voiceId = unusedPool[hash % unusedPool.length];
            } else {
              const hash = [...speaker].reduce((h, c) => h + c.charCodeAt(0), 0);
              voiceId = pool[hash % pool.length];
            }
            
            characterVoiceMap.set(speaker, voiceId);
            usedVoiceIds.add(voiceId);
          }

          return {
            speaker,
            gender,
            age,
            bubblePosition: d.bubblePosition || 'center',
            text: d.text || '',
            emotion: d.emotion || 'neutral',
            voiceId
          };
        }),
      })),
    };

    // セッションにメタデータを保存
    session.metadata = metadata;
    session.status = 'analyzed';

    const totalDialogues = metadata.panels.reduce((s, p) => s + p.dialogues.length, 0);
    const speakers = [...new Set(metadata.panels.flatMap(p => p.dialogues.map(d => d.speaker)))];

    console.log(`  ✅ OCR完了: "${metadata.title}"`);
    console.log(`     コマ数: ${metadata.panels.length}, セリフ数: ${totalDialogues}`);
    console.log(`     話者: ${speakers.join(', ')}`);

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
    console.log(`\n🎬 [Generate] 動画生成を開始: ${sessionId}`);
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
          bubblePosition: d.bubblePosition || 'center',
          text: d.text,
          emotion: d.emotion,
          panelIndex: (panel.panelNumber || 1) - 1,
        });
      }
    }

    console.log(`  📖 タイトル: ${title}`);
    console.log(`  💬 セリフ数: ${dialogues.length}`);

    // --- AI感情連動BGM生成 ---
    console.log('  🎵 AI感情連動BGMを生成中...');
    const emotionCounts = {};
    for (const d of dialogues) {
      if (d.emotion) {
        emotionCounts[d.emotion] = (emotionCounts[d.emotion] || 0) + 1;
      }
    }
    // 最も頻出する感情を抽出
    let dominantMood = 'happy';
    let maxCount = 0;
    for (const [mood, count] of Object.entries(emotionCounts)) {
      if (count > maxCount) {
        maxCount = count;
        dominantMood = mood;
      }
    }
    // BGMファイルはセッションIDごとに作成せず、上書きで対応
    generateBgm(dominantMood);

    // ── 画像分割 (sharp) ──
    console.log('  ✂️ 画像をコマごとに分割中...');
    const publicPanelsDir = path.join(__dirname, 'public', 'panels');
    if (!fs.existsSync(publicPanelsDir)) fs.mkdirSync(publicPanelsDir, { recursive: true });

    const metadataImg = await sharp(session.imagePath).metadata();
    const width = metadataImg.width;
    const height = metadataImg.height;

    const panelCount = Math.max(1, metadata.panels.length);
    const panelPaths = [];
    const aspectRatio = width / height;
    
    let layout = 'grid';
    // A4縦 (約0.707) も縦割り (vertical) と判定させるため、閾値を0.9に緩和
    if (aspectRatio < 0.9) layout = 'vertical';
    else if (aspectRatio > 1.5) layout = 'horizontal';

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
    console.log(`    ✅ ${panelCount}コマに分割完了 (${layout})`);

    // アウトロ用にオリジナル画像全体もコピー
    const originalImageName = `${sessionId}_full.png`;
    const originalImagePath = path.join(publicPanelsDir, originalImageName);
    fs.copyFileSync(session.imagePath, originalImagePath);
    const originalImagePublicPath = `panels/${originalImageName}`;

    // ── VOICEVOX 音声合成 ──
    console.log('  🎙️ VOICEVOX 音声合成...');
    const publicVoiceDir = path.join(__dirname, 'public', 'voiceover', sessionId);
    if (!fs.existsSync(publicVoiceDir)) fs.mkdirSync(publicVoiceDir, { recursive: true });

    const audioFiles = [];
    for (let i = 0; i < dialogues.length; i++) {
      const d = dialogues[i];
      const speakerId = getSpeakerId(d);
      const filename = `line_${String(i + 1).padStart(2, '0')}.wav`;
      const filepath = path.join(publicVoiceDir, filename);

      const displayText = d.text.length > 25 ? d.text.substring(0, 25) + '...' : d.text;
      console.log(`    [${i + 1}/${dialogues.length}] "${displayText}" → Speaker ${speakerId}`);

      try {
        // audio_query
        const queryRes = await fetch(
          `http://127.0.0.1:50021/audio_query?text=${encodeURIComponent(d.text)}&speaker=${speakerId}`,
          { method: 'POST' }
        );
        const query = await queryRes.json();
        
        // 基本スピード
        query.speedScale = 1.25;

        // 見た目からの感情推定を音声パラメーターに反映（ピッチ変更は不自然になるためスピードのみ）
        switch (d.emotion) {
          case 'angry':
            query.speedScale = 1.35;
            break;
          case 'sad':
          case 'worried':
            query.speedScale = 1.1;
            break;
          case 'happy':
          case 'excited':
            query.speedScale = 1.3;
            break;
          case 'surprised':
            query.speedScale = 1.35;
            break;
        }

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
        console.log(`      ✅ ${durationSec.toFixed(2)}s → ${filename}`);
      } catch (err) {
        console.error(`      ❌ 音声生成失敗: ${err.message}`);
        audioFiles.push({ filename, publicPath: null, durationSec: 3, dialogue: d });
      }
    }

    // ── タイトルコール音声 ──
    console.log('  📢 タイトルコール音声生成...');
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
      console.log(`    ✅ タイトルコール音声生成完了 (${titleDurationSec.toFixed(2)}s)`);
    } catch (err) {
      console.log(`    ⚠️ タイトルコール生成スキップ: ${err.message}`);
      var titleDurationFrames = 90; // フォールバック
    }

    const scriptData = {
      title,
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
        durationInFrames: Math.ceil(af.durationSec * 30) + 15, // パディング含む
        audioFile: af.publicPath,
      })),
    };
    scriptData.totalDurationInFrames = scriptData.dialogues.reduce(
      (sum, d) => sum + d.durationInFrames, 0
    ) + scriptData.titleDurationInFrames + 180; // タイトルカード余白 + アウトロ余白(180)

    const scriptDataPath = path.join(__dirname, 'temp', sessionId, 'scriptData.json');
    fs.writeFileSync(scriptDataPath, JSON.stringify(scriptData, null, 2), 'utf8');

    // 出力パス
    const outDir = path.join(__dirname, 'out');
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
    const outputPath = path.join(outDir, `voice_comic_${timestamp}.mp4`);

    // ── Remotion レンダリング ──
    console.log('  🎬 Remotion 動画レンダリングを開始...');
    const compositionId = 'VoiceComic';

    // Vite経由でバンドル
    console.log('    📦 プロジェクトをバンドル中...');
    const bundledPath = await bundle({
      entryPoint: path.join(__dirname, 'src', 'index.ts'),
      webpackOverride: (config) => config,
    });

    console.log('    🎥 コンポジションを抽出中...');
    const composition = await selectComposition({
      serveUrl: bundledPath,
      id: compositionId,
      inputProps: { scriptData },
    });

    // 動的に計算されたフレーム数をコンポジションに上書き設定
    composition.durationInFrames = scriptData.totalDurationInFrames;

    console.log(`    ⏳ レンダリング中 (${composition.durationInFrames} frames) ...`);
    await renderMedia({
      composition,
      serveUrl: bundledPath,
      codec: 'h264',
      outputLocation: outputPath,
      inputProps: { scriptData },
      onProgress: ({ progress }) => {
        if (progress % 0.1 < 0.01) {
          console.log(`      ... ${(progress * 100).toFixed(0)}%`);
        }
      },
    });

    session.status = 'complete';
    session.videoPath = outputPath;
    session.scriptData = scriptData;

    console.log(`\n✅ [Generate] 処理完了: ${outputPath}`);
    res.json({ videoPath: outputPath, scriptData });

  } catch (err) {
    console.error('❌ Generation error:', err);
    session.status = 'error';
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
 * 話者の属性（性別・年齢）からスマート・キャスティング
 * ※ずんだもん(3)はタイトル専用のため除外
 */
function getSpeakerId(dialogue) {
  if (dialogue.voiceId) return dialogue.voiceId;

  const speaker = dialogue.speaker || '';
  const gender = dialogue.gender || 'unknown';
  const age = dialogue.age || 'young';

  // ナレーション等
  if (speaker.includes('ナレ') || speaker.includes('narr')) return 2; // 四国めたんノーマル

  // 名前による完全一致（ずんだもん排除）
  const exactMap = {
    '四国めたん': 2, '春日部つむぎ': 8, '九州そら': 16, 
    '波音リツ': 9, '雨晴はう': 10, '玄野武宏': 11,
    '白上虎太郎': 12, '青山龍星': 13, '冥鳴ひまり': 14,
  };
  for (const [key, id] of Object.entries(exactMap)) {
    if (speaker.includes(key)) return id;
  }

  // ハッシュ計算（同一キャラには常に同じ声を当てるため）
  const hash = [...speaker].reduce((h, c) => h + c.charCodeAt(0), 0);

  let pool = [8, 16, 2, 14, 10]; // デフォルトは女性キャラ（4コマに多いため）

  if (gender === 'female') {
    if (age === 'child' || age === 'young') pool = [8, 2, 10, 14]; // つむぎ, めたん, はう, ひまり
    else pool = [16, 14, 2]; // 九州そら(大人の女性ぽい), ひまり
  } else if (gender === 'male') {
    if (age === 'child') pool = [12]; // 白上虎太郎(少年)
    else if (age === 'young') pool = [13, 12]; // 青山龍星(青年), 虎太郎
    else pool = [11, 13]; // 玄野武宏(渋い), 龍星
  }

  const fallbackId = pool[hash % pool.length];
  console.log(`    🎭 [Casting] ${speaker} (${gender}, ${age}) → Voice ID: ${fallbackId}`);
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
