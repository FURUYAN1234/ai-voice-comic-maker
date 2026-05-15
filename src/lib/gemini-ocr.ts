/**
 * gemini-ocr.ts
 * 
 * Gemini Vision API で漫画画像を解析し、
 * タイトル・コマ構成・セリフ・話者を全自動で抽出する。
 * 
 * ユーザーはJSONを一切用意する必要がない。
 * 画像をドロップするだけで全てAIが判断する。
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

/** OCR結果の型定義 */
export interface OcrResult {
  /** 漫画のタイトル（AIが推定） */
  title: string;
  /** コマごとのデータ */
  panels: Array<{
    panelNumber: number;
    dialogues: Array<{
      speaker: string;
      text: string;
      emotion?: string;
    }>;
  }>;
}

/** Gemini Vision OCR のプロンプト */
const OCR_PROMPT = `あなたは漫画解析AIです。この漫画画像を詳細に分析してください。

## タスク
1. この漫画画像に含まれるコマ（パネル）を上から順に識別する
2. 各コマ内のセリフ（吹き出しのテキスト）を読み取る
3. 各セリフの話者を判定する（キャラクターの外見・位置から推定）
4. 各セリフの感情を推定する
5. 漫画全体のタイトルを推定する（画像内にタイトルがあればそれを使用、なければ内容から推定）

## 出力形式
以下のJSON形式で出力してください。JSONのみを出力し、マークダウンのコードブロックは使わないでください。

{
  "title": "漫画のタイトル",
  "panels": [
    {
      "panelNumber": 1,
      "dialogues": [
        {
          "speaker": "キャラ名（推定）",
          "text": "セリフの内容",
          "emotion": "感情（neutral/happy/sad/angry/surprised/excited/worried等）"
        }
      ]
    }
  ]
}

## ルール
- セリフは吹き出し内のテキストを正確に読み取ること
- 話者名はキャラクターの外見的特徴から分かりやすい名前を付けること（例: 「青髪の少女」「メガネの男」等）
- 同じキャラクターには一貫した名前を使うこと
- ナレーション（吹き出し外のテキスト）は speaker を "ナレーション" にすること
- コマは上から下、左から右の順に番号を振ること
- 効果音やオノマトペはスキップしてよい（セリフのみ抽出）
- 日本語の漫画を想定しているが、他言語の場合もそのまま読み取ること`;

/**
 * Gemini Vision APIで漫画画像を解析する
 * 
 * @param imagePath - 解析する画像ファイルの絶対パス
 * @param apiKey - Gemini API Key（省略時は環境変数から取得）
 * @returns OCR結果
 */
export async function analyzeComicImage(
  imagePath: string,
  apiKey?: string,
): Promise<OcrResult> {
  const key = apiKey || process.env.GEMINI_API_KEY;
  if (!key || key === 'your_gemini_api_key_here') {
    throw new Error(
      'GEMINI_API_KEY が設定されていません。\n' +
      '画面上部の入力欄にAPIキーを入力するか、.env ファイルに設定してください。\n' +
      '取得先: https://aistudio.google.com/apikey'
    );
  }

  const genAI = new GoogleGenerativeAI(key);
  const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

  // 画像をBase64に変換
  const imageBuffer = fs.readFileSync(imagePath);
  const base64Image = imageBuffer.toString('base64');
  const mimeType = getMimeType(imagePath);

  console.log(`  🔍 Gemini Vision OCR 解析中... (${path.basename(imagePath)})`);

  // Gemini API呼び出し
  const result = await model.generateContent([
    OCR_PROMPT,
    {
      inlineData: {
        mimeType,
        data: base64Image,
      },
    },
  ]);

  const responseText = result.response.text();
  console.log(`  📝 Gemini レスポンス受信 (${responseText.length}文字)`);

  // JSONをパース
  const ocrResult = parseGeminiResponse(responseText);
  
  console.log(`  ✅ OCR完了: "${ocrResult.title}" / ${ocrResult.panels.length}コマ`);
  
  // セリフ数を集計
  const totalDialogues = ocrResult.panels.reduce(
    (sum, p) => sum + p.dialogues.length, 0
  );
  console.log(`     セリフ数: ${totalDialogues}`);
  
  // 話者一覧
  const speakers = [...new Set(
    ocrResult.panels.flatMap(p => p.dialogues.map(d => d.speaker))
  )];
  console.log(`     話者: ${speakers.join(', ')}`);

  return ocrResult;
}

/**
 * Geminiのレスポンステキストからクリーンなオブジェクトを取得
 */
function parseGeminiResponse(text: string): OcrResult {
  // マークダウンのコードブロックを除去
  let cleaned = text.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
  }

  try {
    const parsed = JSON.parse(cleaned);
    
    // 最低限の構造を保証
    return {
      title: parsed.title || '無題の漫画',
      panels: (parsed.panels || []).map((p: any, i: number) => ({
        panelNumber: p.panelNumber || i + 1,
        dialogues: (p.dialogues || []).map((d: any) => ({
          speaker: d.speaker || '不明',
          text: d.text || '',
          emotion: d.emotion || 'neutral',
        })),
      })),
    };
  } catch (e) {
    console.error('⚠️ Gemini レスポンスのJSONパースに失敗。リカバリーを試みます...');
    
    // JSONの部分一致を試みる
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const fallback = JSON.parse(jsonMatch[0]);
        return {
          title: fallback.title || '無題の漫画',
          panels: fallback.panels || [],
        };
      } catch {
        // 最終フォールバック
      }
    }

    throw new Error(
      'Geminiの応答からメタデータを抽出できませんでした。\n' +
      '画像が漫画として認識されなかった可能性があります。再度お試しください。'
    );
  }
}

/**
 * ファイル拡張子からMIMEタイプを取得
 */
function getMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const mimeMap: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
  };
  return mimeMap[ext] || 'image/png';
}
