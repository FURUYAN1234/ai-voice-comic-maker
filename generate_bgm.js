import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 感情に合わせたBGM生成関数
export function generateBgm(mood = 'happy', outputPath = path.join(__dirname, 'public', 'audio', 'bgm.wav')) {
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

  let scale, melody, tempoBps, waveType;

  if (mood === 'angry') {
    // 怒り・緊迫 (マイナースケール、速い、ノコギリ波風)
    scale = [261.63, 293.66, 311.13, 349.23, 392.00, 415.30, 466.16]; // C Minor
    melody = [0, 2, 3, 0, 4, 3, 2, 0];
    tempoBps = 10; // 速い
    waveType = 'sawtooth';
  } else if (mood === 'sad' || mood === 'worried') {
    // 悲しみ・不安 (マイナースケール、遅い、サイン波風)
    scale = [261.63, 293.66, 311.13, 349.23, 392.00, 415.30, 466.16]; // C Minor
    melody = [0, 4, 3, 2, 0, 4, 2, 1];
    tempoBps = 3; // 遅い
    waveType = 'sine';
  } else {
    // 楽しい・日常 (メジャーペンタトニック、ポップ、矩形波風)
    scale = [261.63, 293.66, 329.63, 392.00, 440.00, 523.25, 587.33]; // C Major Pentatonic
    melody = [0, 2, 4, 5, 4, 2, 0, 2, 3, 4, 2, 0, 2, 4, 5, 6];
    tempoBps = 8; // ポップな速さ
    waveType = 'square';
  }

  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    
    // メロディのインデックス
    const noteIndex = Math.floor(t * tempoBps) % melody.length;
    const freq = scale[melody[noteIndex]];
    
    // エンベロープ (スタッカート気味にする)
    const noteTime = t * tempoBps - Math.floor(t * tempoBps);
    let envelope = Math.max(0, 1 - noteTime * 2.0); // 歯切れよく
    if (waveType === 'sine') envelope = Math.max(0, 1 - noteTime * 1.0); // サイン波は伸びやかに
    
    // 波形生成
    const period = 1 / freq;
    const pos = (t % period) / period;
    let wave = 0;
    
    if (waveType === 'square') {
      wave = pos < 0.5 ? 1 : -1;
    } else if (waveType === 'sawtooth') {
      wave = 2 * pos - 1;
    } else { // sine (pseudo)
      wave = Math.sin(2 * Math.PI * pos);
    }
    
    // ベース音 (コード進行感)
    const rootFreq = scale[Math.floor(t * (tempoBps / 4)) % 4 === 0 ? 0 : 2] / 2;
    const basePos = (t % (1/rootFreq)) / (1/rootFreq);
    const baseWave = basePos < 0.5 ? 1 : -1; // ベースは矩形波で太く
    
    // ミックスして音量調整
    const sample = (wave * envelope * 0.5 + baseWave * 0.3) * 32767 * 0.15; // 音量を抑えめに
    buffer.writeInt16LE(Math.max(-32768, Math.min(32767, sample)), 44 + i * 2);
  }

  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  fs.writeFileSync(outputPath, buffer);
  console.log(`✅ AI感情連動BGM (${mood}) が生成されました: ${outputPath}`);
}

// 直接実行された場合の処理
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const argMood = process.argv[2] || 'happy';
  generateBgm(argMood);
}
