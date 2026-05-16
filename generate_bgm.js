import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ========================================
// プロシージャル作曲エンジン v2.0
// 感情に基づき毎回異なる8bitチップチューンBGMを自動生成
// ========================================

const emotion = process.argv[2] || 'happy';
const seed = parseInt(process.argv[3]) || Date.now();
console.log(`🎵 BGM生成モード: ${emotion} (seed: ${seed})`);

// ── シード付き疑似乱数 (Mulberry32) ──
function createRng(s) {
  let state = s | 0;
  return () => {
    state = (state + 0x6D2B79F5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = createRng(seed);
const pick = (arr) => arr[Math.floor(rng() * arr.length)];
const randRange = (min, max) => Math.floor(rng() * (max - min + 1)) + min;

// ── 音楽理論定数 ──
function noteFreq(midi) { return 440 * Math.pow(2, (midi - 69) / 12); }

const ROOTS = { C:60, Db:61, D:62, Eb:63, E:64, F:65, Gb:66, G:67, Ab:68, A:69, Bb:70, B:71 };

const SCALES = {
  major:           [0,2,4,5,7,9,11],
  minor:           [0,2,3,5,7,8,10],
  pentaMaj:        [0,2,4,7,9],
  pentaMin:        [0,3,5,7,10],
  dorian:          [0,2,3,5,7,9,10],
  mixolydian:      [0,2,4,5,7,9,10],
  harmonicMin:     [0,2,3,5,7,8,11],
  blues:           [0,3,5,6,7,10],
  wholeTone:       [0,2,4,6,8,10],
};

// コード進行 (スケール度数 0=I ~ 6=VII)
const PROGRESSIONS = {
  happy:     [[0,3,4,0],[0,4,5,3],[0,5,3,4],[0,2,3,4],[0,3,4,5]],
  excited:   [[0,4,3,4],[0,3,4,0],[0,4,5,3],[0,0,3,4]],
  neutral:   [[0,3,4,0],[0,5,3,4],[0,3,0,4],[0,3,5,4]],
  sad:       [[0,3,4,0],[0,5,2,6],[0,3,6,2],[0,5,3,4]],
  worried:   [[0,3,6,4],[0,5,3,4],[0,1,3,0],[0,6,5,4]],
  angry:     [[0,6,5,4],[0,4,0,3],[0,3,0,6],[0,0,3,4],[0,5,6,0]],
  surprised: [[0,4,5,2],[0,3,6,4],[0,2,4,0],[0,6,3,4]],
};

// 感情パラメータ
const PARAMS = {
  happy:     { scales:[{r:'C',s:'major'},{r:'G',s:'major'},{r:'D',s:'major'},{r:'F',s:'pentaMaj'},{r:'C',s:'pentaMaj'}], bpm:[120,150], waves:['square','pulse25'], oct:[4,5], staccato:0.7, drumVol:0.6 },
  excited:   { scales:[{r:'A',s:'major'},{r:'E',s:'major'},{r:'Bb',s:'major'},{r:'G',s:'pentaMaj'}], bpm:[150,180], waves:['square','pulse25','sawtooth'], oct:[4,5], staccato:0.8, drumVol:0.7 },
  neutral:   { scales:[{r:'C',s:'major'},{r:'F',s:'major'},{r:'G',s:'mixolydian'},{r:'C',s:'pentaMaj'}], bpm:[110,130], waves:['square','triangle'], oct:[4,5], staccato:0.5, drumVol:0.4 },
  sad:       { scales:[{r:'A',s:'minor'},{r:'D',s:'minor'},{r:'E',s:'minor'},{r:'C',s:'minor'},{r:'A',s:'pentaMin'}], bpm:[70,100], waves:['sine','triangle'], oct:[3,4], staccato:0.2, drumVol:0.2 },
  worried:   { scales:[{r:'B',s:'minor'},{r:'Gb',s:'minor'},{r:'D',s:'dorian'},{r:'A',s:'harmonicMin'}], bpm:[90,120], waves:['triangle','sine','pulse25'], oct:[3,4], staccato:0.4, drumVol:0.3 },
  angry:     { scales:[{r:'E',s:'minor'},{r:'A',s:'minor'},{r:'C',s:'minor'},{r:'D',s:'blues'},{r:'E',s:'pentaMin'}], bpm:[140,175], waves:['sawtooth','square'], oct:[3,4], staccato:0.9, drumVol:0.7 },
  surprised: { scales:[{r:'C',s:'wholeTone'},{r:'C',s:'major'},{r:'A',s:'harmonicMin'},{r:'D',s:'mixolydian'}], bpm:[130,160], waves:['square','pulse25','sawtooth'], oct:[4,5], staccato:0.6, drumVol:0.5 },
};

// メロディリズム (16ステップ = 1小節, 16分音符グリッド)
const MELODY_RHYTHMS = [
  [1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0],
  [1,0,0,1,0,0,1,0,1,0,0,1,0,0,1,0],
  [1,0,1,0,1,0,0,1,1,0,1,0,0,1,0,0],
  [1,0,0,0,1,0,1,0,1,0,0,0,1,0,1,0],
  [1,1,0,1,1,0,1,0,1,1,0,1,0,0,1,0],
  [1,0,1,0,0,0,1,0,0,0,1,0,1,0,0,0],
  [1,0,0,1,1,0,0,1,1,0,1,0,0,1,1,0],
];

// ベースリズム
const BASS_RHYTHMS = [
  [1,0,0,0,0,0,1,0,1,0,0,0,0,0,1,0],
  [1,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0],
  [1,0,1,0,0,0,1,0,0,0,1,0,1,0,0,0],
  [1,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0],
  [1,0,0,1,0,0,1,0,1,0,0,1,0,0,1,0],
];

// ドラムパターン
const KICK_PATTERNS  = [[1,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0],[1,0,0,0,0,0,1,0,1,0,0,0,0,0,1,0],[1,0,0,1,0,0,0,0,1,0,0,0,0,1,0,0],[1,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0]];
const SNARE_PATTERNS = [[0,0,0,0,1,0,0,0,0,0,0,0,1,0,0,0],[0,0,0,0,1,0,0,1,0,0,0,0,1,0,0,0],[0,0,0,0,1,0,0,0,0,0,1,0,0,0,1,0]];
const HIHAT_PATTERNS = [[1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0],[1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],[1,0,1,1,1,0,1,1,1,0,1,1,1,0,1,1],[1,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0]];

// ── 選択フェーズ ──
const p = PARAMS[emotion] || PARAMS.neutral;
const sc = pick(p.scales);
const rootMidi = ROOTS[sc.r];
const scaleIntervals = SCALES[sc.s];
const chords = pick(PROGRESSIONS[emotion] || PROGRESSIONS.neutral);
const bpm = randRange(p.bpm[0], p.bpm[1]);
const wave = pick(p.waves);
const melRhythm = pick(MELODY_RHYTHMS);
const bassRhythm = pick(BASS_RHYTHMS);
const kickPat = pick(KICK_PATTERNS);
const snarePat = pick(SNARE_PATTERNS);
const hihatPat = pick(HIHAT_PATTERNS);

console.log(`  🎹 スケール: ${sc.r} ${sc.s}`);
console.log(`  🎵 コード: ${chords.map(c=>['I','II','III','IV','V','VI','VII'][c]).join('-')}`);
console.log(`  ⏱️ BPM: ${bpm} | 🔊 波形: ${wave}`);

// ── スケールノート全域展開 ──
const allNotes = [];
for (let oct = p.oct[0] - 1; oct <= p.oct[1] + 1; oct++) {
  for (const iv of scaleIntervals) allNotes.push(rootMidi + (oct - 4) * 12 + iv);
}

// ── コードトーン取得 ──
function chordTones(degree) {
  const len = scaleIntervals.length;
  return [
    scaleIntervals[degree % len],
    scaleIntervals[(degree + 2) % len],
    scaleIntervals[(degree + 4) % len],
  ];
}

// ── メロディセクション生成 ──
function genMelody(startNote) {
  const notes = [];
  let cur = startNote;
  for (let step = 0; step < 16; step++) {
    if (melRhythm[step] === 0) { notes.push(null); continue; }
    const ci = Math.floor(step / 4) % chords.length;
    const ct = chordTones(chords[ci]);
    const r = rng();
    if (r < 0.4) {
      // コードトーンへ跳躍
      const tone = pick(ct);
      const oct = pick(p.oct);
      cur = rootMidi + (oct - 4) * 12 + tone;
    } else if (r < 0.7) {
      // 順次進行 (1-2度)
      const dir = rng() < 0.5 ? 1 : -1;
      const amt = rng() < 0.7 ? 1 : 2;
      const idx = allNotes.indexOf(cur);
      if (idx >= 0) cur = allNotes[Math.max(0, Math.min(allNotes.length - 1, idx + dir * amt))];
    } else if (r < 0.85) {
      // 跳躍 (3-5度)
      const dir = rng() < 0.5 ? 1 : -1;
      const amt = randRange(3, 5);
      const idx = allNotes.indexOf(cur);
      if (idx >= 0) cur = allNotes[Math.max(0, Math.min(allNotes.length - 1, idx + dir * amt))];
    }
    // else: 同音繰り返し
    const lo = rootMidi + (p.oct[0] - 4) * 12;
    const hi = rootMidi + (p.oct[1] - 4) * 12 + 11;
    while (cur < lo) cur += 12;
    while (cur > hi) cur -= 12;
    notes.push(cur);
  }
  return notes;
}

const startN = rootMidi + (pick(p.oct) - 4) * 12;
const secA = genMelody(startN);
const secB = genMelody(startN + (rng() < 0.5 ? 2 : -2));
const structure = rng() < 0.5 ? ['A','A','B','A'] : ['A','B','A','B'];
const fullMelody = structure.flatMap(s => s === 'A' ? secA : secB);

// ── ベースライン生成 ──
const bassLine = [];
for (let step = 0; step < 16; step++) {
  if (bassRhythm[step] === 0) { bassLine.push(null); continue; }
  const ci = Math.floor(step / 4) % chords.length;
  const deg = chords[ci];
  if (rng() < 0.2) {
    const fifth = scaleIntervals[(deg + 4) % scaleIntervals.length];
    bassLine.push(rootMidi - 12 + fifth);
  } else {
    bassLine.push(rootMidi - 12 + scaleIntervals[deg % scaleIntervals.length]);
  }
}

// ── 波形生成関数 ──
function waveGen(type, phase) {
  const ph = phase % 1;
  switch (type) {
    case 'square':   return ph < 0.5 ? 1 : -1;
    case 'pulse25':  return ph < 0.25 ? 1 : -1;
    case 'sawtooth': return 2 * ph - 1;
    case 'triangle': return ph < 0.5 ? (4 * ph - 1) : (3 - 4 * ph);
    case 'sine':     return Math.sin(2 * Math.PI * ph);
    default:         return ph < 0.5 ? 1 : -1;
  }
}

// ── ドラム音合成 ──
function drumHit(type, t, dur) {
  const prog = t / dur;
  if (prog > 1) return 0;
  if (type === 'kick') {
    const f = 150 * Math.exp(-prog * 8) + 40;
    return Math.sin(2 * Math.PI * f * t) * Math.exp(-prog * 6) * 0.8;
  } else if (type === 'snare') {
    const n = (Math.random() * 2 - 1) * Math.exp(-prog * 12) * 0.5;
    const tone = Math.sin(2 * Math.PI * 200 * t) * Math.exp(-prog * 8) * 0.3;
    return n + tone;
  } else { // hihat
    return (Math.random() * 2 - 1) * Math.exp(-prog * 20) * 0.3;
  }
}

// ── WAVレンダリング ──
const sampleRate = 44100;
const durationSec = 30;
const numSamples = sampleRate * durationSec;
const buffer = Buffer.alloc(44 + numSamples * 2);

// WAVヘッダ
buffer.write('RIFF', 0);
buffer.writeUInt32LE(36 + numSamples * 2, 4);
buffer.write('WAVE', 8);
buffer.write('fmt ', 12);
buffer.writeUInt32LE(16, 16);
buffer.writeUInt16LE(1, 20);
buffer.writeUInt16LE(1, 22);
buffer.writeUInt32LE(sampleRate, 24);
buffer.writeUInt32LE(sampleRate * 2, 28);
buffer.writeUInt16LE(2, 32);
buffer.writeUInt16LE(16, 34);
buffer.write('data', 36);
buffer.writeUInt32LE(numSamples * 2, 40);

const stepDur = 60 / bpm / 4; // 16分音符の秒数
let melPhase = 0;
let bassPhase = 0;

// ドラムイベントキュー（各ステップの発音開始時刻を追跡）
const drumEvents = { kick: -1, snare: -1, hihat: -1 };
const drumDurs = { kick: 0.15, snare: 0.1, hihat: 0.05 };

for (let i = 0; i < numSamples; i++) {
  const t = i / sampleRate;
  const curStep = Math.floor(t / stepDur);
  const stepTime = t - curStep * stepDur;
  const stepProg = stepTime / stepDur;
  const barStep = curStep % 16;

  // ── メロディ ──
  const melIdx = curStep % fullMelody.length;
  const melNote = fullMelody[melIdx];
  let melSample = 0;
  if (melNote !== null) {
    melPhase += noteFreq(melNote) / sampleRate;
    const env = p.staccato > 0.5
      ? Math.max(0, 1 - stepProg * (2 + p.staccato * 3))
      : Math.max(0, 1 - stepProg * 0.5);
    melSample = waveGen(wave, melPhase) * env;
  }

  // ── ベース ──
  const bassNote = bassLine[barStep];
  let bassSample = 0;
  if (bassNote !== null) {
    bassPhase += noteFreq(bassNote) / sampleRate;
    const env = Math.max(0, 1 - stepProg * 1.5);
    bassSample = waveGen('square', bassPhase) * env;
  }

  // ── ドラム ──
  // 新しいステップでトリガー更新
  if (stepTime < 1 / sampleRate + 0.0001) {
    if (kickPat[barStep])  drumEvents.kick  = t;
    if (snarePat[barStep]) drumEvents.snare = t;
    if (hihatPat[barStep]) drumEvents.hihat = t;
  }
  let drumSample = 0;
  for (const dtype of ['kick', 'snare', 'hihat']) {
    if (drumEvents[dtype] >= 0) {
      const dt = t - drumEvents[dtype];
      if (dt < drumDurs[dtype]) drumSample += drumHit(dtype, dt, drumDurs[dtype]);
    }
  }

  // ── ミックス ──
  const melVol = 0.35;
  const bassVol = 0.25;
  const drumVol = p.drumVol * 0.35;
  const mix = (melSample * melVol + bassSample * bassVol + drumSample * drumVol) * 32767 * 0.7;
  buffer.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(mix))), 44 + i * 2);
}

// ── 出力 ──
const dir = path.join(__dirname, 'public', 'audio');
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'bgm.wav'), buffer);
console.log(`✅ ${emotion}風のプロシージャルBGMが生成されました: public/audio/bgm.wav`);
