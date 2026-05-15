/**
 * Remotion Configuration
 * 
 * AI Voice Comic Maker - 縦型ボイスコミック動画生成
 * https://remotion.dev/docs/config
 */

import { Config } from "@remotion/cli/config";

// 出力フォーマット設定
Config.setVideoImageFormat("jpeg");

// 上書き許可（既存ファイルを毎回上書きする）
Config.setOverwriteOutput(true);
