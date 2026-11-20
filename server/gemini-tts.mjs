import { GEMINI_TITLE_VOICE, GEMINI_VOICES } from '../src/gemini-voices.js';

export const GEMINI_TTS_MODEL = 'gemini-3.8-flash-tts';

const voices = {
  female: ['Kore', 'Aoede', 'Zephyr', 'Leda', 'Gacrux', 'Sulafat', 'Autonoe', 'Despina', 'Erinome',
    'Laomedeia', 'Achernar', 'Pulcherrima', 'Vindemiatrix', 'Callirrhoe'],
  male: ['Charon', 'Puck', 'Fenrir', 'Orus', 'Iapetus', 'Umbriel', 'Enceladus', 'Algieba', 'Algenib',
    'Rasalgethi', 'Alnilam', 'Schedar', 'Achird', 'Zubenelgenubi', 'Sadachbia', 'Sadaltager'],
};
const emotions = new Map([
  ['happy', 'Warm and cheerful.'], ['sad', 'Quiet and sad.'],
  ['angry', 'Tense and firm.'], ['surprised', 'Genuinely surprised.'],
  ['excited', 'Animated and excited.'], ['fearful', 'Nervous and tense.'],
]);

export function createGeminiVoiceCasting() {
  const assigned = new Map();
  const used = new Set();
  return ({ speaker = 'Unknown', gender }) => {
    if (assigned.has(speaker)) return assigned.get(speaker);
    const preferred = Object.hasOwn(voices, gender) ? voices[gender] : ['Zephyr', 'Puck', 'Aoede', 'Charon'];
    const voice = preferred.find(name => !used.has(name))
      ?? GEMINI_VOICES.find(name => !used.has(name)) ?? preferred[0];
    used.add(voice);
    assigned.set(speaker, voice);
    return voice;
  };
}

function wavDuration(bytes) {
  const invalid = () => { throw new Error('Gemini TTSが有効なWAV音声を返しませんでした。'); };
  if (bytes.length < 44 || bytes.toString('ascii', 0, 4) !== 'RIFF'
    || bytes.toString('ascii', 8, 12) !== 'WAVE' || bytes.readUInt32LE(4) + 8 !== bytes.length) invalid();
  let byteRate = 0;
  let audioBytes = 0;
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const size = bytes.readUInt32LE(offset + 4);
    const type = bytes.toString('ascii', offset, offset + 4);
    const data = offset + 8;
    if (data + size > bytes.length) invalid();
    if (type === 'fmt ') {
      if (size < 16 || bytes.readUInt16LE(data) !== 1 || bytes.readUInt16LE(data + 2) !== 1
        || bytes.readUInt16LE(data + 14) !== 16) invalid();
      byteRate = bytes.readUInt32LE(data + 8);
      if (byteRate !== bytes.readUInt32LE(data + 4) * 2) invalid();
    }
    if (type === 'data') audioBytes += size;
    offset = data + size + size % 2;
  }
  if (!byteRate || !audioBytes || audioBytes % 2) invalid();
  return audioBytes / byteRate;
}

export async function synthesizeGeminiTts({ key, text, voice = GEMINI_TITLE_VOICE, emotion, isEnglish, signal }) {
  const direction = isEnglish ? 'Speak naturally in English.' : 'Speak naturally in Japanese.';
  const style = `${direction} ${emotions.get(emotion) ?? 'Read the line clearly in a natural conversational tone.'}`;
  const response = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    signal: AbortSignal.any([signal, AbortSignal.timeout(90_000)]),
    body: JSON.stringify({
      model: GEMINI_TTS_MODEL, store: false,
      input: [{ type: 'user_input', content: [{ type: 'text', text, annotations: [{ type: 'speech_metadata', style }] }] }],
      response_format: { type: 'audio', mime_type: 'audio/wav', sample_rate: 24000 },
      generation_config: { speech_config: [{ voice }] },
    }),
  });
  if (!response.ok) throw new Error(`Gemini TTSの音声合成に失敗しました（HTTP ${response.status}）。`);
  const result = await response.json();
  signal.throwIfAborted();
  const content = (result.steps ?? []).filter(step => step.type === 'model_output').flatMap(step => step.content ?? []);
  const audio = content.filter(part => part.type === 'audio');
  if (result.status !== 'completed' || audio.length !== 1 || audio[0].mime_type !== 'audio/wav'
    || typeof audio[0].data !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(audio[0].data)) {
    throw new Error('Gemini TTSがWAV音声を返しませんでした。');
  }
  const bytes = Buffer.from(audio[0].data, 'base64');
  return { bytes, durationSec: wavDuration(bytes) };
}
