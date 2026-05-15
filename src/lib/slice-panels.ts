/**
 * slice-panels.ts
 * 
 * 4コマ漫画画像を個別のコマに自動分割する。
 * sharp を使用して画像を均等に4分割し、
 * public/panels/ に保存する。
 * 
 * 分割ロジック:
 * - 縦長画像（H > W * 1.5）→ 縦に4等分
 * - 横長画像（W > H * 1.5）→ 横に4等分
 * - 正方形に近い場合（2x2）→ 2行2列のグリッド分割
 */

import sharp from 'sharp';
import fs from 'fs';
import path from 'path';

export interface SliceResult {
  /** 分割されたコマ画像のパス（public/panels/配下の相対パス） */
  panelPaths: string[];
  /** 元画像の幅 */
  originalWidth: number;
  /** 元画像の高さ */
  originalHeight: number;
  /** 分割パターン（vertical | horizontal | grid） */
  layout: 'vertical' | 'horizontal' | 'grid';
}

/**
 * 4コマ漫画画像を個別コマに分割
 * 
 * @param imagePath - 入力画像の絶対パス
 * @param outputDir - 出力先ディレクトリ（デフォルト: public/panels/）
 * @param panelCount - 分割コマ数（デフォルト: 4）
 * @returns 分割結果
 */
export async function slicePanels(
  imagePath: string,
  outputDir?: string,
  panelCount: number = 4
): Promise<SliceResult> {
  const panelsDir = outputDir || path.join(process.cwd(), 'public', 'panels');
  
  // 出力ディレクトリを作成
  if (!fs.existsSync(panelsDir)) {
    fs.mkdirSync(panelsDir, { recursive: true });
  }

  // 画像メタデータを取得
  const metadata = await sharp(imagePath).metadata();
  const { width, height } = metadata;

  if (!width || !height) {
    throw new Error(`画像のサイズを取得できませんでした: ${imagePath}`);
  }

  console.log(`  📐 画像サイズ: ${width}x${height}`);

  // レイアウト自動判定
  const aspectRatio = width / height;
  let layout: SliceResult['layout'];

  if (aspectRatio < 0.67) {
    // 縦長 → 縦に4分割（典型的な4コマ漫画）
    layout = 'vertical';
  } else if (aspectRatio > 1.5) {
    // 横長 → 横に4分割
    layout = 'horizontal';
  } else {
    // 正方形に近い → 2x2グリッド
    layout = 'grid';
  }

  console.log(`  📊 レイアウト判定: ${layout} (aspect: ${aspectRatio.toFixed(2)})`);

  const panelPaths: string[] = [];
  const baseName = path.basename(imagePath, path.extname(imagePath));

  for (let i = 0; i < panelCount; i++) {
    let extractRegion: { left: number; top: number; width: number; height: number };

    switch (layout) {
      case 'vertical': {
        // 縦に均等分割
        const panelHeight = Math.floor(height / panelCount);
        extractRegion = {
          left: 0,
          top: panelHeight * i,
          width: width,
          height: i < panelCount - 1 ? panelHeight : height - panelHeight * i,
        };
        break;
      }
      case 'horizontal': {
        // 横に均等分割
        const panelWidth = Math.floor(width / panelCount);
        extractRegion = {
          left: panelWidth * i,
          top: 0,
          width: i < panelCount - 1 ? panelWidth : width - panelWidth * i,
          height: height,
        };
        break;
      }
      case 'grid': {
        // 2x2グリッド分割
        const cols = 2;
        const rows = 2;
        const panelWidth = Math.floor(width / cols);
        const panelHeight = Math.floor(height / rows);
        const col = i % cols;
        const row = Math.floor(i / cols);
        extractRegion = {
          left: panelWidth * col,
          top: panelHeight * row,
          width: col < cols - 1 ? panelWidth : width - panelWidth * col,
          height: row < rows - 1 ? panelHeight : height - panelHeight * row,
        };
        break;
      }
    }

    const outputFileName = `${baseName}_panel_${i + 1}.png`;
    const outputPath = path.join(panelsDir, outputFileName);

    await sharp(imagePath)
      .extract(extractRegion)
      .png({ quality: 95 })
      .toFile(outputPath);

    // Remotionが使うpublic/相対パス
    panelPaths.push(`panels/${outputFileName}`);
    console.log(`  ✂️ コマ${i + 1}: ${extractRegion.width}x${extractRegion.height} → ${outputFileName}`);
  }

  return {
    panelPaths,
    originalWidth: width,
    originalHeight: height,
    layout,
  };
}

/**
 * CLIエントリポイント
 * npx tsx src/lib/slice-panels.ts で直接実行可能
 */
async function main() {
  const INPUT_DIR = path.join(process.cwd(), 'input');
  const imageFiles = fs.readdirSync(INPUT_DIR)
    .filter(f => /\.(png|jpg|jpeg|webp)$/i.test(f))
    .sort();

  if (imageFiles.length === 0) {
    console.error('❌ input/ に画像ファイルが見つかりません。');
    process.exit(1);
  }

  console.log(`🖼️ ${imageFiles.length}件の画像を分割します...`);

  for (const img of imageFiles) {
    console.log(`\n📷 処理中: ${img}`);
    const result = await slicePanels(path.join(INPUT_DIR, img));
    console.log(`  ✅ ${result.panelPaths.length}コマに分割完了 (${result.layout})`);
  }

  console.log('\n🎉 全画像の分割が完了しました！');
}

// CLIとして直接実行された場合
if (process.argv[1]?.includes('slice-panels')) {
  main().catch(err => {
    console.error('❌ コマ分割エラー:', err.message);
    process.exit(1);
  });
}
