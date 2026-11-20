export const GEMINI_VOICES = Object.freeze([
  'Kore', 'Aoede', 'Puck', 'Charon', 'Zephyr', 'Fenrir', 'Leda', 'Orus', 'Callirrhoe', 'Autonoe',
  'Enceladus', 'Iapetus', 'Umbriel', 'Algieba', 'Despina', 'Erinome', 'Algenib', 'Rasalgethi',
  'Laomedeia', 'Achernar', 'Alnilam', 'Schedar', 'Gacrux', 'Pulcherrima', 'Achird',
  'Zubenelgenubi', 'Vindemiatrix', 'Sadachbia', 'Sadaltager', 'Sulafat',
]);

export const GEMINI_TITLE_VOICE = 'Callirrhoe';

const pageObject = /^(?:書類|資料|名札|モニター|テレビ|看板|張り紙|紙|フリップ|擬音|効果音|document|caption on screen|nameplate|monitor|sign|sound effect)$/iu;

export function isGeminiPageText(line) {
  return line.textRole === 'story_text' || line.textRole === 'sfx' || pageObject.test(line.speaker?.trim() ?? '');
}

export function getGeminiVoiceAssignments(metadata, includePageText = false) {
  const assignments = new Map();
  for (const panel of metadata.panels) {
    for (const line of panel.dialogues ?? []) {
      if (!includePageText && isGeminiPageText(line)) continue;
      if (!assignments.has(line.speaker)) assignments.set(line.speaker, line.geminiVoiceId);
    }
  }
  return [...assignments].map(([speaker, voice]) => ({ speaker, voice }));
}

export function validateGeminiVoiceAssignments(entries, detectedSpeakers) {
  const speakers = new Set(detectedSpeakers);
  const assignments = new Map();
  if (!Array.isArray(entries) || entries.length > speakers.size) throw new Error('配役の入力が無効です。');
  for (const entry of entries) {
    if (!entry || !speakers.has(entry.speaker) || assignments.has(entry.speaker)
      || !GEMINI_VOICES.includes(entry.voice)) throw new Error('検出された話者に標準音声を一つずつ指定してください。');
    assignments.set(entry.speaker, entry.voice);
  }
  return assignments;
}
