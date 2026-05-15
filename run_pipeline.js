/**
 * AI Voice Comic Maker - 統合パイプライン
 * 
 * 漫画画像 + metadata.json → 声付きショート動画
 * 全工程を一気通貫で実行する。
 * 
 * remotion_video_2 のパターンを継承:
 * - BOM自動除去
 * - ロックファイル（二重実行防止）
 * - カスケードタイムアウト
 * - UTF-8強制
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

// UTF-8エンコーディングを強制（Windows環境対策）
process.env.LANG = 'ja_JP.UTF-8';

console.log('================================================================');
console.log('🎬 AI Voice Comic Maker パイプラインを開始します');
console.log('================================================================\n');

// パイプライン全体のタイムアウト（30分）
let pipelineTimeout = setTimeout(() => {
    console.error("❌ [FATAL] パイプライン全体が30分を超過しました。強制終了します。");
    process.exit(1);
}, 1800000);

// package.json の BOM を自動除去（Windows環境で頻繁に発生する問題対策）
const pkgPath = path.join(process.cwd(), 'package.json');
try {
    let pkgContent = fs.readFileSync(pkgPath, 'utf8');
    if (pkgContent.charCodeAt(0) === 0xFEFF) {
        pkgContent = pkgContent.slice(1);
        fs.writeFileSync(pkgPath, pkgContent, 'utf8');
        console.log('⚠️ package.json の BOM を自動除去しました');
    }
} catch (e) {
    // BOM除去の失敗は致命的ではないので無視
}

try {
    const LOCK_FILE = path.join(process.cwd(), '.pipeline_lock');
    
    // ── ロックファイルチェック ──
    if (fs.existsSync(LOCK_FILE)) {
        const stats = fs.statSync(LOCK_FILE);
        const ageInMinutes = (Date.now() - stats.mtimeMs) / (1000 * 60);
        if (ageInMinutes < 1) {
            console.error('❌ [Safety Lock] パイプラインは1分以内に実行されたばかりです。');
            console.error('   強制する場合は .pipeline_lock を削除してください。');
            process.exit(1);
        } else {
            console.log('⚠️ 古いロックファイルを上書きします。');
            try { fs.unlinkSync(LOCK_FILE); } catch(e) {}
        }
    }
    fs.writeFileSync(LOCK_FILE, Date.now().toString(), 'utf8');

    // ── Step 0: input/ フォルダの確認 ──
    console.log('📂 [Step 0] input/ フォルダを確認中...');
    const inputDir = path.join(process.cwd(), 'input');
    if (!fs.existsSync(inputDir)) {
        fs.mkdirSync(inputDir, { recursive: true });
    }
    
    // 入力ファイルを検索
    const inputFiles = fs.readdirSync(inputDir).filter(f => {
        const ext = path.extname(f).toLowerCase();
        return ['.png', '.jpg', '.jpeg', '.webp', '.json'].includes(ext);
    });
    
    if (inputFiles.length === 0) {
        console.error('❌ input/ フォルダにファイルが見つかりません。');
        console.error('   漫画画像 (.png/.jpg) と metadata.json を配置してください。');
        console.error('   サンプルデータ: input/sample/ を参照');
        process.exit(1);
    }
    
    // 画像ファイルとJSONファイルを分離
    const imageFiles = inputFiles.filter(f => /\.(png|jpg|jpeg|webp)$/i.test(f));
    const jsonFiles = inputFiles.filter(f => /\.json$/i.test(f));
    
    console.log(`   📷 画像ファイル: ${imageFiles.length}件`);
    console.log(`   📄 JSONファイル: ${jsonFiles.length}件`);
    console.log('✅ 入力ファイルを検出\n');

    // ── Step 1: メタデータ解析＆コマ分割 ──
    console.log('🧠 [Step 1] メタデータ解析＆コマ画像分割...');
    try {
        execSync('npx tsx src/lib/parse-metadata.ts', { stdio: 'inherit' });
        console.log('✅ メタデータ解析完了\n');
    } catch (e) {
        console.error('❌ メタデータ解析で致命的エラー。パイプラインを停止します。');
        process.exit(1);
    }

    // ── Step 2: VOICEVOX 音声合成 ──
    console.log('🎙️ [Step 2] VOICEVOX 音声合成...');
    
    // VOICEVOX ヘルスチェック
    try {
        execSync('node -e "const ac = new AbortController(); setTimeout(()=>ac.abort(), 3000); fetch(\'http://127.0.0.1:50021/version\', {signal: ac.signal}).then(res => {if(!res.ok) throw new Error(\'VOICEVOX Error\')}).catch(() => process.exit(1))"');
        console.log('   ✅ VOICEVOX Engine 接続OK');
    } catch {
        console.error('   ❌ VOICEVOX Engine に接続できません。');
        console.error('   bootstrap.ps1 で自動起動されるはずですが、手動起動が必要かもしれません。');
        process.exit(1);
    }
    
    try {
        execSync('npx tsx generate-voiceover.ts', { stdio: 'inherit' });
        console.log('✅ 音声合成完了\n');
    } catch (e) {
        console.error('❌ 音声合成でエラーが発生しました。');
        process.exit(1);
    }

    // ── Step 3: Remotion 動画レンダリング ──
    console.log('🎥 [Step 3] Remotion 動画レンダリング...');
    
    // タイムスタンプベースのファイル名
    const now = new Date();
    const timestamp = `${now.getFullYear()}${(now.getMonth() + 1).toString().padStart(2, '0')}${now.getDate().toString().padStart(2, '0')}${now.getHours().toString().padStart(2, '0')}${now.getMinutes().toString().padStart(2, '0')}${now.getSeconds().toString().padStart(2, '0')}`;
    const outputFileName = `voice_comic_${timestamp}.mp4`;
    const outputPath = `out/${outputFileName}`;
    
    // 出力ディレクトリ作成
    if (!fs.existsSync('out')) {
        fs.mkdirSync('out', { recursive: true });
    }
    
    execSync(`npx remotion render src/index.ts VoiceComic "${outputPath}"`, { stdio: 'inherit' });
    console.log('✅ 動画レンダリング完了！\n');

    // ── 完了 ──
    console.log(`🎉 すべてのプロセスが正常に終了しました！`);
    console.log(`   📁 出力: ${outputPath}`);
    console.log('');

    // 動画の自動再生 (Windows向け)
    console.log('▶️ 生成された動画を再生します...');
    try {
        // 既存のメディアプレイヤーを終了
        execSync('taskkill /F /IM Microsoft.Media.Player.exe /IM Video.UI.exe /T 2>nul', { stdio: 'ignore' });
    } catch (e) {
        // プレイヤーが起動していなかった場合は無視
    }
    execSync(`start "" "${path.resolve(outputPath)}"`);

} catch (error) {
    console.error('\n❌ パイプライン実行中にエラーが発生しました:');
    console.error(error.message);
    process.exit(1);
} finally {
    clearTimeout(pipelineTimeout);
    // ロックファイル解除
    const LOCK_FILE = path.join(process.cwd(), '.pipeline_lock');
    if (fs.existsSync(LOCK_FILE)) {
        fs.unlinkSync(LOCK_FILE);
    }
    // デバッグログのクリーンアップ
    try {
        const outDir = path.join(process.cwd(), 'out');
        if (fs.existsSync(outDir)) {
            for (const file of fs.readdirSync(outDir)) {
                if (file.includes('debug') && file.endsWith('.log')) {
                    fs.unlinkSync(path.join(outDir, file));
                }
            }
        }
    } catch (e) {
        // クリーンアップの失敗は無視
    }
}
