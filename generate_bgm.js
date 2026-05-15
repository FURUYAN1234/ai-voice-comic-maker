import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 感情パラメータの取得
const emotion = process.argv[2] || 'happy';
console.log(`🎵 BGM生成モード: ${emotion}`);

const sampleRate = 44100;
const durationSec = 30;
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
buffer.writeUInt32LE(sampleRate * 2, 28);
buffer.writeUInt16LE(2, 32);
buffer.writeUInt16LE(16, 34);
buffer.write('data', 36);
buffer.writeUInt32LE(numSamples * 2, 40);

// 感情ごとのスケール（音階）とBPM設定
let scale, melody, bpm, waveType;

if (emotion === 'angry') {
  scale = [220.00, 246.94, 261.63, 293.66, 329.63, 349.23, 392.00, 440.00]; // A Minor
  melody = [0, 2, 4, 2, 0, 4, 5, 4, 7, 5, 4, 2, 0, 2, 4, 5];
  bpm = 160;
  waveType = 'sawtooth'; // 鋭い音
} else if (emotion === 'sad' || emotion === 'worried') {
  scale = [220.00, 246.94, 261.63, 293.66, 329.63, 349.23, 392.00, 440.00]; // A Minor
  melody = [4, 2, 0, 2, 4, 4, 4, 2, 2, 2, 4, 7, 7, 4, 2, 0]; // ゆったり
  bpm = 90;
  waveType = 'sine'; // 丸い音
} else {
  // happy, excited, neutral (デフォルトは明るく楽しいファミコン風)
  scale = [261.63, 293.66, 329.63, 392.00, 440.00, 523.25, 587.33, 659.25]; // C Major Pentatonic
  melody = [0, 2, 4, 7, 9, 7, 4, 2, 0, 0, 2, 4, 7, 9, 7, 0];
  bpm = 140;
  waveType = 'square'; // ピコピコ音
}

const bps = bpm / 60; // 1秒あたりの拍数
const notesPerSecond = bps * 2; // 8分音符ベース

for (let i = 0; i < numSamples; i++) {
  const t = i / sampleRate;
  
  const noteIndex = Math.floor(t * notesPerSecond) % melody.length;
  const freq = scale[melody[noteIndex]];
  
  // 短く弾むような減衰 (スタッカート)
  const noteTime = t * notesPerSecond - Math.floor(t * notesPerSecond);
  let envelope;
  if (emotion === 'sad' || emotion === 'worried') {
    envelope = Math.max(0, 1 - noteTime * 0.8); // ゆったり減衰
  } else {
    envelope = Math.max(0, 1 - noteTime * 4.0); // ポンッと短く切る
  }
  
  const period = 1 / freq;
  const pos = (t % period) / period;
  
  let wave = 0;
  if (waveType === 'square') {
    wave = pos < 0.5 ? 1 : -1;
  } else if (waveType === 'sawtooth') {
    wave = 2 * pos - 1;
  } else {
    wave = Math.sin(2 * Math.PI * pos);
  }
  
  // ベース音 (ルート音のオクターブ下をポンポコ鳴らす)
  const rootFreq = scale[0] / 2;
  const basePos = (t % (1/rootFreq)) / (1/rootFreq);
  let baseWave = basePos < 0.5 ? 1 : -1; // ベースは常に矩形波
  const baseEnvelope = Math.max(0, 1 - (t * bps - Math.floor(t * bps)) * 2.0);
  
  // ミックス
  const sample = (wave * envelope * 0.4 + baseWave * baseEnvelope * 0.3) * 32767 * 0.15;
  buffer.writeInt16LE(Math.max(-32768, Math.min(32767, sample)), 44 + i * 2);
}

const dir = path.join(__dirname, 'public', 'audio');
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

fs.writeFileSync(path.join(dir, 'bgm.wav'), buffer);
console.log(`✅ ${emotion}風のBGMが生成されました: public/audio/bgm.wav`);
