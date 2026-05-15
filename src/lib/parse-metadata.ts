/**
 * metadata.json パーサー
 * 
 * Nano Banana Pro が出力した metadata.json を読み込み、
 * Remotion用の scriptData.json に変換する。
 * 
 * Phase 2 統合版:
 * - sharp による4コマ画像自動分割
 * - cast-voices による自動キャスティング
 */

import fs from 'fs';
import path from 'path';
import { slicePanels } from './slice-panels.js';
import { castVoices } from './cast-voices.js';

// 入出力ディレクトリ
const INPUT_DIR = path.join(process.cwd(), 'input');
const OUTPUT_DATA = path.join(process.cwd(), 'src', 'data', 'scriptData.json');
const PANELS_DIR = path.join(process.cwd(), 'public', 'panels');

interface NanoBananaMetadata {
  title?: string;
  panels: Array<{
    panelNumber: number;
    dialogues: Array<{
      speaker: string;
      text: string;
      emotion?: string;
    }>;
  }>;
}

interface ScriptDataOutput {
  title: string;
  panels: string[];
  dialogues: Array<{
    id: string;
    speaker: string;
    text: string;
    panelIndex: number;
    durationInFrames: number;
    audioFile: string;
    speakerId: number;
    emotion?: string;
  }>;
  totalDurationInFrames: number;
  casting: Record<string, number>;
}

async function main() {
  console.log('📖 metadata.json の読み込み...');

  // JSONファイルを探す
  const jsonFiles = fs.readdirSync(INPUT_DIR).filter(f => f.endsWith('.json'));
  if (jsonFiles.length === 0) {
    console.error('❌ input/ に .json ファイルが見つかりません。');
    process.exit(1);
  }

  const metadataPath = path.join(INPUT_DIR, jsonFiles[0]);
  const rawData = fs.readFileSync(metadataPath, 'utf8');
  
  // BOM除去
  const cleanData = rawData.charCodeAt(0) === 0xFEFF ? rawData.slice(1) : rawData;
  const metadata: NanoBananaMetadata = JSON.parse(cleanData);

  const title = metadata.title || 'ボイスコミック';
  console.log(`   📄 読み込み: ${jsonFiles[0]}`);
  console.log(`   📝 タイトル: ${title}`);
  console.log(`   📝 コマ数: ${metadata.panels?.length || 0}`);

  // 画像ファイルを探す
  const imageFiles = fs.readdirSync(INPUT_DIR)
    .filter(f => /\.(png|jpg|jpeg|webp)$/i.test(f))
    .sort();

  if (imageFiles.length === 0) {
    console.error('❌ input/ に画像ファイルが見つかりません。');
    process.exit(1);
  }

  console.log(`   🖼️ 画像: ${imageFiles.join(', ')}`);

  // ── 画像分割 ──
  let panelPaths: string[] = [];

  if (imageFiles.length === 1) {
    // 1枚の4コマ画像 → sharp で自動分割
    console.log('\n🔪 4コマ画像の自動分割を実行...');
    const panelCount = metadata.panels?.length || 4;
    const result = await slicePanels(
      path.join(INPUT_DIR, imageFiles[0]),
      PANELS_DIR,
      panelCount
    );
    panelPaths = result.panelPaths;
    console.log(`   ✅ ${result.layout} レイアウトで ${panelPaths.length} コマに分割完了`);
  } else {
    // 複数画像 → 個別コマとしてそのままコピー
    console.log('\n📋 個別コマ画像をコピー...');
    if (!fs.existsSync(PANELS_DIR)) {
      fs.mkdirSync(PANELS_DIR, { recursive: true });
    }
    for (const img of imageFiles) {
      const src = path.join(INPUT_DIR, img);
      const dest = path.join(PANELS_DIR, img);
      fs.copyFileSync(src, dest);
      panelPaths.push(`panels/${img}`);
    }
    console.log(`   ✅ ${panelPaths.length} 枚のコマ画像をコピー完了`);
  }

  // ── キャスティング ──
  console.log('\n🎭 キャラクターのキャスティング...');
  const allSpeakers = (metadata.panels || [])
    .flatMap(p => (p.dialogues || []).map(d => d.speaker));
  
  const { casting, log: castLog } = castVoices(allSpeakers);
  for (const line of castLog) {
    console.log(`   ${line}`);
  }

  // ── scriptData.json を構築 ──
  const FPS = 30;
  const DEFAULT_LINE_DURATION = 3 * FPS; // デフォルト3秒/セリフ（VOICEVOX音声の長さで後で上書き）
  
  let lineCounter = 0;
  const dialogues: ScriptDataOutput['dialogues'] = [];

  if (metadata.panels) {
    for (const panel of metadata.panels) {
      const panelIdx = (panel.panelNumber || 1) - 1;
      for (const dialogue of panel.dialogues || []) {
        lineCounter++;
        const lineId = `line_${lineCounter.toString().padStart(2, '0')}`;
        const speakerId = casting[dialogue.speaker] ?? 3; // フォールバック: ずんだもん
        dialogues.push({
          id: lineId,
          speaker: dialogue.speaker,
          text: dialogue.text,
          panelIndex: Math.min(panelIdx, panelPaths.length - 1),
          durationInFrames: DEFAULT_LINE_DURATION,
          audioFile: `voiceover/${lineId}.wav`,
          speakerId,
          emotion: dialogue.emotion,
        });
      }
    }
  }

  const totalFrames = dialogues.reduce((sum, d) => sum + d.durationInFrames, 0);

  const scriptData: ScriptDataOutput = {
    title,
    panels: panelPaths,
    dialogues,
    totalDurationInFrames: totalFrames || 900,
    casting,
  };

  // data ディレクトリ作成＆書き出し
  const dataDir = path.dirname(OUTPUT_DATA);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  fs.writeFileSync(OUTPUT_DATA, JSON.stringify(scriptData, null, 2), 'utf8');

  console.log(`\n   ✅ scriptData.json 生成完了`);
  console.log(`      セリフ数: ${dialogues.length}`);
  console.log(`      コマ数: ${panelPaths.length}`);
  console.log(`      キャスト数: ${Object.keys(casting).length}`);
}

main().catch(err => {
  console.error('❌ メタデータ解析エラー:', err.message);
  process.exit(1);
});
