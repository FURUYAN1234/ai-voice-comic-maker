import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 簡易的なWAV生成ロジック (8-bit風のピコピコBGM)
const sampleRate = 44100;
const durationSec = 30; // 30秒ループ
const numSamples = sampleRate * durationSec;
const buffer = Buffer.alloc(44 + numSamples * 2);

// WAV ヘッダ
buffer.write('RIFF', 0);
buffer.writeUInt32LE(36 + numSamples * 2, 4);
buffer.write('WAVE', 8);
buffer.write('fmt ', 12);
buffer.writeUInt32LE(16, 16);
buffer.writeUInt16LE(1, 20); // PCM
buffer.writeUInt16LE(1, 22); // Mono
buffer.writeUInt32LE(sampleRate, 24);
buffer.writeUInt32LE(sampleRate * 2, 28); // ByteRate
buffer.writeUInt16LE(2, 32); // BlockAlign
buffer.writeUInt16LE(16, 34); // BitsPerSample
buffer.write('data', 36);
buffer.writeUInt32LE(numSamples * 2, 40);

// ドリアンスケールの周波数 (少しオシャレな日常系響き)
const scale = [261.63, 293.66, 311.13, 349.23, 392.00, 440.00, 466.16, 523.25];
// メロディのパターン
const melody = [0, 2, 4, 5, 7, 4, 2, 0, 2, 4, 2, 1, 0, 2, 4, 7];

for (let i = 0; i < numSamples; i++) {
  const t = i / sampleRate;
  
  // テンポ: 1秒間に6音
  const noteIndex = Math.floor(t * 6) % melody.length;
  const freq = scale[melody[noteIndex]];
  
  // エンベロープ (音が減衰する処理)
  const noteTime = t * 6 - Math.floor(t * 6);
  const envelope = Math.max(0, 1 - noteTime * 1.5); // 短く減衰
  
  // 三角波 (柔らかいピコピコ音)
  const period = 1 / freq;
  const pos = (t % period) / period;
  const wave = 4 * Math.abs(pos - 0.5) - 1;
  
  // ベース音 (コード進行感)
  const rootFreq = scale[Math.floor(t * 1.5) % 4 === 0 ? 0 : 2] / 2;
  const basePos = (t % (1/rootFreq)) / (1/rootFreq);
  const baseWave = 4 * Math.abs(basePos - 0.5) - 1;
  
  // ミックスして音量調整
  const sample = (wave * envelope * 0.6 + baseWave * 0.4) * 32767 * 0.2; // 全体の音量0.2
  buffer.writeInt16LE(Math.max(-32768, Math.min(32767, sample)), 44 + i * 2);
}

const dir = path.join(__dirname, 'public', 'audio');
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

fs.writeFileSync(path.join(dir, 'bgm.wav'), buffer);
console.log('✅ AI(簡易プログラム)によるBGMが生成されました: public/audio/bgm.wav');
