/**
 * VOICEVOX REST API クライアント
 * 
 * ローカルで稼働するVOICEVOX Engineに対して
 * テキスト→音声合成を行うラッパー。
 */

import fs from 'fs';
import path from 'path';

const VOICEVOX_URL = process.env.VOICEVOX_URL || 'http://127.0.0.1:50021';

/**
 * VOICEVOXキャラクター（話者）のIDマッピング
 * https://voicevox.hiroshiba.jp/ 公式キャラクター一覧
 */
export const VOICE_MAP: Record<string, number> = {
  // ── 主要キャラクター ──
  'ずんだもん': 3,         // ノーマル
  '四国めたん': 2,         // ノーマル
  '春日部つむぎ': 8,      // ノーマル
  '九州そら': 16,          // ノーマル
  '波音リツ': 9,           // ノーマル
  '雨晴はう': 10,          // ノーマル
  '玄野武宏': 11,          // ノーマル
  '白上虎太郎': 12,        // ノーマル
  '青山龍星': 13,          // ノーマル
  '冥鳴ひまり': 14,        // ノーマル
  '小夜/SAYO': 46,         // ノーマル
  
  // ── remotion_video_2 互換エイリアス ──
  'アカリ': 8,             // 春日部つむぎ
  'ヒカリ': 16,            // 九州そら

  // ── 汎用ラベル ──
  'A': 8,                  // 春日部つむぎ
  'B': 16,                 // 九州そら
  'ナレーション': 2,       // 四国めたん（落ち着いた声）
  'ナレーター': 2,
  'narration': 2,
};

/**
 * テキストから音声データ（WAVバイナリ）を生成
 */
export async function synthesize(
  text: string,
  speakerId: number,
  options?: {
    speedScale?: number;
    pitchScale?: number;
    volumeScale?: number;
  }
): Promise<Buffer> {
  // Step 1: 音声合成用のクエリを生成
  const queryRes = await fetch(
    `${VOICEVOX_URL}/audio_query?text=${encodeURIComponent(text)}&speaker=${speakerId}`,
    { method: 'POST' }
  );
  
  if (!queryRes.ok) {
    throw new Error(`VOICEVOX audio_query failed: ${queryRes.status} ${queryRes.statusText}`);
  }
  
  const query = await queryRes.json();

  // オプション適用
  if (options?.speedScale) query.speedScale = options.speedScale;
  if (options?.pitchScale) query.pitchScale = options.pitchScale;
  if (options?.volumeScale) query.volumeScale = options.volumeScale;

  // Step 2: 音声合成を実行
  const synthRes = await fetch(
    `${VOICEVOX_URL}/synthesis?speaker=${speakerId}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(query),
    }
  );

  if (!synthRes.ok) {
    throw new Error(`VOICEVOX synthesis failed: ${synthRes.status} ${synthRes.statusText}`);
  }

  const arrayBuffer = await synthRes.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

/**
 * 話者名からVOICEVOX Speaker IDを取得
 * 未知の話者名はデフォルト（ずんだもん）にフォールバック
 */
export function getSpeakerId(speakerName: string): number {
  // 完全一致
  if (VOICE_MAP[speakerName] !== undefined) {
    return VOICE_MAP[speakerName];
  }
  
  // 部分一致（「ずんだもん（ノーマル）」等）
  for (const [key, id] of Object.entries(VOICE_MAP)) {
    if (speakerName.includes(key)) {
      return id;
    }
  }
  
  // デフォルトフォールバック
  console.warn(`⚠️ 未知の話者名 "${speakerName}" → ずんだもん (ID: 3) にフォールバック`);
  return 3; // ずんだもん
}

/**
 * 音声ファイルのWAVヘッダーからDuration(秒)を取得
 */
export function getWavDuration(wavBuffer: Buffer): number {
  // WAVファイルフォーマット: データサイズ / (サンプリングレート * チャンネル数 * ビットデプス/8)
  const sampleRate = wavBuffer.readUInt32LE(24);
  const byteRate = wavBuffer.readUInt32LE(28);
  
  // dataチャンク位置を探す
  let offset = 12;
  while (offset < wavBuffer.length - 8) {
    const chunkId = wavBuffer.toString('ascii', offset, offset + 4);
    const chunkSize = wavBuffer.readUInt32LE(offset + 4);
    if (chunkId === 'data') {
      return chunkSize / byteRate;
    }
    offset += 8 + chunkSize;
  }
  
  // フォールバック: 全体サイズから推定
  return (wavBuffer.length - 44) / byteRate;
}
