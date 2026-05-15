/**
 * cast-voices.ts
 * 
 * キャラクター属性に基づいてVOICEVOX Speaker IDを自動キャスティング。
 * metadata.json の speaker フィールドから最適な音声を選択する。
 * 
 * キャスティングロジック:
 * 1. 完全一致: 名前がVOICE_MAPに完全一致
 * 2. 部分一致: 名前の一部がキーに含まれる
 * 3. 性別推定: 名前の末尾や漢字から性別を推定し、適切なデフォルトを割り当て
 * 4. ラウンドロビン: 同性別キャラが複数いる場合、声を分散させる
 */

import { VOICE_MAP, getSpeakerId } from './voicevox-client.js';

/** キャスティング結果 */
export interface CastResult {
  /** 話者名 → Speaker ID のマッピング */
  casting: Record<string, number>;
  /** キャスティング詳細ログ */
  log: string[];
}

/** 性別ごとのデフォルト音声プール */
const FEMALE_VOICES = [
  { name: '春日部つむぎ', id: 8 },
  { name: '九州そら', id: 16 },
  { name: '四国めたん', id: 2 },
  { name: '冥鳴ひまり', id: 14 },
  { name: '雨晴はう', id: 10 },
];

const MALE_VOICES = [
  { name: '玄野武宏', id: 11 },
  { name: '白上虎太郎', id: 12 },
  { name: '青山龍星', id: 13 },
];

const NEUTRAL_VOICES = [
  { name: 'ずんだもん', id: 3 },
  { name: '波音リツ', id: 9 },
];

/**
 * 名前から性別を推定する（簡易ヒューリスティック）
 */
function guessGender(name: string): 'female' | 'male' | 'neutral' {
  // 明確な女性名の末尾パターン
  const femalePatterns = /[子美花菜奈恵理里莉衣依海咲桜優彩愛結麻紗沙]$/;
  // 明確な男性名の末尾パターン
  const malePatterns = /[太郎介助平男雄夫翔大輝斗也人士朗哉彦]$/;

  // ナレーション系
  if (/ナレ|narr/i.test(name)) return 'neutral';
  
  // パターンマッチ
  if (femalePatterns.test(name)) return 'female';
  if (malePatterns.test(name)) return 'male';
  
  // A/B等の汎用ラベル
  if (/^[A-Z]$/.test(name)) return 'neutral';
  
  // カタカナ名で末尾が「ア」「エ」「ナ」「ミ」→ 女性寄り
  if (/[アエナミリカ]$/.test(name) && /^[\u30A0-\u30FF]+$/.test(name)) return 'female';
  // カタカナ名で末尾が「オ」「ロ」「タ」→ 男性寄り
  if (/[オロタスケ]$/.test(name) && /^[\u30A0-\u30FF]+$/.test(name)) return 'male';

  return 'neutral';
}

/**
 * 複数キャラクターの音声を自動キャスティング
 * 
 * @param speakerNames - キャラクター名の配列（重複あり可）
 * @returns キャスティング結果
 */
export function castVoices(speakerNames: string[]): CastResult {
  // ユニークな話者名を抽出
  const uniqueSpeakers = [...new Set(speakerNames)];
  const casting: Record<string, number> = {};
  const log: string[] = [];
  
  // ラウンドロビン用カウンター
  const usedFemale = new Set<number>();
  const usedMale = new Set<number>();
  const usedNeutral = new Set<number>();

  for (const speaker of uniqueSpeakers) {
    // Step 1: VOICE_MAP で完全一致チェック
    if (VOICE_MAP[speaker] !== undefined) {
      casting[speaker] = VOICE_MAP[speaker];
      log.push(`✅ ${speaker} → ID:${VOICE_MAP[speaker]} (完全一致)`);
      continue;
    }

    // Step 2: 部分一致チェック
    let partialMatch = false;
    for (const [key, id] of Object.entries(VOICE_MAP)) {
      if (speaker.includes(key) || key.includes(speaker)) {
        casting[speaker] = id;
        log.push(`✅ ${speaker} → ID:${id} (部分一致: "${key}")`);
        partialMatch = true;
        break;
      }
    }
    if (partialMatch) continue;

    // Step 3: 性別推定 + ラウンドロビン割り当て
    const gender = guessGender(speaker);
    let pool: typeof FEMALE_VOICES;
    let usedSet: Set<number>;

    switch (gender) {
      case 'female':
        pool = FEMALE_VOICES;
        usedSet = usedFemale;
        break;
      case 'male':
        pool = MALE_VOICES;
        usedSet = usedMale;
        break;
      default:
        pool = NEUTRAL_VOICES;
        usedSet = usedNeutral;
        break;
    }

    // まだ使われていない声を優先的に割り当て
    const available = pool.filter(v => !usedSet.has(v.id));
    const chosen = available.length > 0 ? available[0] : pool[0];

    casting[speaker] = chosen.id;
    usedSet.add(chosen.id);
    log.push(`🎯 ${speaker} → ID:${chosen.id} (${chosen.name}) [推定: ${gender}]`);
  }

  return { casting, log };
}

/**
 * CLIエントリポイント
 */
async function main() {
  // テスト用データ
  const testSpeakers = ['花子', '太郎', 'ナレーション', 'ずんだもん', '不明なキャラ'];
  
  console.log('🎭 キャスティングテスト:');
  const result = castVoices(testSpeakers);
  
  for (const line of result.log) {
    console.log(`  ${line}`);
  }
  
  console.log('\n📋 最終キャスティング:', JSON.stringify(result.casting, null, 2));
}

if (process.argv[1]?.includes('cast-voices')) {
  main();
}
