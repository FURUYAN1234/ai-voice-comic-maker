/**
 * generate-voiceover.ts
 * 
 * scriptData.json を読み込み、VOICEVOX Engine で各セリフの音声を生成。
 * 音声ファイル (WAV) を public/voiceover/ に保存し、
 * 実測のduration情報で scriptData.json を更新する。
 */

import fs from 'fs';
import path from 'path';
import { synthesize, getWavDuration } from './src/lib/voicevox-client.js';

// パス定義
const SCRIPT_DATA_PATH = path.join(process.cwd(), 'src', 'data', 'scriptData.json');
const VOICEOVER_DIR = path.join(process.cwd(), 'public', 'voiceover');
const FPS = 30;

interface DialogueLine {
  id: string;
  speaker: string;
  text: string;
  panelIndex: number;
  durationInFrames: number;
  audioFile: string;
  speakerId: number;
  emotion?: string;
}

interface ScriptData {
  title: string;
  panels: string[];
  dialogues: DialogueLine[];
  totalDurationInFrames: number;
  casting: Record<string, number>;
}

async function main() {
  console.log('🎙️ VOICEVOX 音声合成を開始...\n');

  // ── scriptData.json の読み込み ──
  if (!fs.existsSync(SCRIPT_DATA_PATH)) {
    console.error('❌ src/data/scriptData.json が見つかりません。');
    console.error('   先に parse-metadata.ts を実行してください。');
    process.exit(1);
  }

  const rawData = fs.readFileSync(SCRIPT_DATA_PATH, 'utf8');
  const cleanData = rawData.charCodeAt(0) === 0xFEFF ? rawData.slice(1) : rawData;
  const scriptData: ScriptData = JSON.parse(cleanData);

  if (scriptData.dialogues.length === 0) {
    console.warn('⚠️ セリフデータがありません。音声生成をスキップします。');
    return;
  }

  console.log(`   📝 タイトル: ${scriptData.title}`);
  console.log(`   💬 セリフ数: ${scriptData.dialogues.length}\n`);

  // ── 出力ディレクトリ作成 ──
  if (!fs.existsSync(VOICEOVER_DIR)) {
    fs.mkdirSync(VOICEOVER_DIR, { recursive: true });
  }

  // ── 各セリフの音声を生成 ──
  let successCount = 0;
  let failCount = 0;

  for (let i = 0; i < scriptData.dialogues.length; i++) {
    const dialogue = scriptData.dialogues[i];
    const filename = `${dialogue.id}.wav`;
    const filepath = path.join(VOICEOVER_DIR, filename);

    console.log(`   [${i + 1}/${scriptData.dialogues.length}] "${dialogue.text.substring(0, 30)}${dialogue.text.length > 30 ? '...' : ''}"`);
    console.log(`     📢 ${dialogue.speaker} → Speaker ID: ${dialogue.speakerId}`);

    try {
      // VOICEVOX で音声合成
      const wavBuffer = await synthesize(dialogue.text, dialogue.speakerId, {
        speedScale: 1.1,  // やや速めでテンポ良く
      });

      // WAVファイルを保存
      fs.writeFileSync(filepath, wavBuffer);

      // 実測のduration (秒) を取得
      const durationSec = getWavDuration(wavBuffer);
      // フレーム数に変換（余白 +15フレーム = 0.5秒のパディング）
      const durationInFrames = Math.ceil(durationSec * FPS) + 15;

      // scriptDataのduration情報を更新
      scriptData.dialogues[i].durationInFrames = durationInFrames;
      scriptData.dialogues[i].audioFile = `voiceover/${filename}`;

      console.log(`     ✅ ${durationSec.toFixed(2)}秒 (${durationInFrames}frames) → ${filename}`);
      successCount++;
    } catch (err: any) {
      console.error(`     ❌ 音声生成失敗: ${err.message}`);
      // フォールバック: デフォルト3秒のまま
      scriptData.dialogues[i].durationInFrames = 3 * FPS + 15;
      failCount++;
    }
  }

  // ── タイトルコール音声の生成 ──
  console.log(`\n   📢 タイトルコール音声を生成中...`);
  const titleAudioPath = path.join(VOICEOVER_DIR, 'title_call.wav');
  try {
    const titleWav = await synthesize(scriptData.title, 3, {
      speedScale: 0.95,  // タイトルはやや遅めで堂々と
      pitchScale: 0.05,  // 少しだけ高め
    });
    fs.writeFileSync(titleAudioPath, titleWav);
    const titleDuration = getWavDuration(titleWav);
    console.log(`     ✅ タイトルコール: ${titleDuration.toFixed(2)}秒`);
  } catch (err: any) {
    console.log(`     ⚠️ タイトルコール生成スキップ: ${err.message}`);
  }

  // ── totalDurationInFrames を再計算 ──
  const titleCardFrames = 90; // タイトルカード: 3秒
  const endCardFrames = 60;   // エンドカード: 2秒
  scriptData.totalDurationInFrames = 
    titleCardFrames + 
    scriptData.dialogues.reduce((sum, d) => sum + d.durationInFrames, 0) +
    endCardFrames;

  // ── scriptData.json を更新 ──
  fs.writeFileSync(SCRIPT_DATA_PATH, JSON.stringify(scriptData, null, 2), 'utf8');
  
  console.log(`\n🎉 音声合成完了！`);
  console.log(`   ✅ 成功: ${successCount}`);
  if (failCount > 0) {
    console.log(`   ❌ 失敗: ${failCount}`);
  }
  console.log(`   🎞️ 動画長: ${(scriptData.totalDurationInFrames / FPS).toFixed(1)}秒 (${scriptData.totalDurationInFrames}frames)`);
}

main().catch(err => {
  console.error('❌ 音声合成エラー:', err.message);
  process.exit(1);
});
