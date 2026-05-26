/**
 * AI Voice Comic Maker - バックエンドサーバー
 * 
 * 正式仕様:
 * 漫画画像をアップロードするだけ → Gemini Vision OCR で全自動解析
 * → VOICEVOX音声合成 → 動画データ返却
 * 
 * JSONは一切不要。全てAIが判断する。
 * 
 * API:
 * - POST /api/upload           : 漫画画像のみアップロード
 * - POST /api/analyze/:id      : Gemini Vision OCR で漫画解析
 * - POST /api/generate/:id     : 音声合成＆動画生成
 * - GET  /api/video/:id        : 生成済み動画の配信
 * - GET  /api/voicevox/status  : VOICEVOX接続確認
 * - GET  /api/gemini/status    : Gemini APIキー設定状態
 * - POST /api/gemini/key       : Gemini APIキーを設定
 */

import express from 'express';
import cors from 'cors';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import sharp from 'sharp';
import { bundle } from '@remotion/bundler';
import { renderMedia, selectComposition } from '@remotion/renderer';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── プリセット読み辞書 (VOICEVOX発音補正用) ──
// VOICEVOX送信前に英字略語・IT用語・現代用語をカタカナ読みに変換する
// ※ 大文字小文字を区別しない（正規表現のiフラグ）
// ※ 単語境界を考慮し、部分一致による誤置換を防ぐ
const PRONUNCIATION_DICT = {
  // --- ネットワーク・インフラ ---
  'NAS': 'ナス',
  'LAN': 'ラン',
  'WAN': 'ワン',
  'VPN': 'ブイピーエヌ',
  'DNS': 'ディーエヌエス',
  'DHCP': 'ディーエイチシーピー',
  'IP': 'アイピー',
  'IPv4': 'アイピーブイフォー',
  'IPv6': 'アイピーブイシックス',
  'TCP': 'ティーシーピー',
  'UDP': 'ユーディーピー',
  'HTTP': 'エイチティーティーピー',
  'HTTPS': 'エイチティーティーピーエス',
  'SSH': 'エスエスエイチ',
  'FTP': 'エフティーピー',
  'Wi-Fi 7': 'ワイファイセブン',
  'WiFi 7': 'ワイファイセブン',
  'Wi-Fi 6E': 'ワイファイシックスイー',
  'WiFi 6E': 'ワイファイシックスイー',
  'Wi-Fi 6': 'ワイファイシックス',
  'WiFi 6': 'ワイファイシックス',
  'WiFi': 'ワイファイ',
  'Wi-Fi': 'ワイファイ',
  'Bluetooth': 'ブルートゥース',
  'IoT': 'アイオーティー',
  '5G': 'ファイブジー',
  '4G': 'フォージー',
  '3G': 'スリージー',
  '6G': 'シックスジー',
  // --- ストレージ・ハードウェア ---
  'SSD': 'エスエスディー',
  'HDD': 'エイチディーディー',
  'RAID': 'レイド',
  'USB': 'ユーエスビー',
  'GPU': 'ジーピーユー',
  'CPU': 'シーピーユー',
  'RAM': 'ラム',
  'ROM': 'ロム',
  'BIOS': 'バイオス',
  'UEFI': 'ユーイーエフアイ',
  'PCIe': 'ピーシーアイエクスプレス',
  'NVMe': 'エヌブイエムイー',
  'HDMI': 'エイチディーエムアイ',
  'DisplayPort': 'ディスプレイポート',
  // --- OS・ソフトウェア ---
  'OS': 'オーエス',
  'Windows 11': 'ウィンドウズイレブン',
  'Windows 10': 'ウィンドウズテン',
  'Windows 8': 'ウィンドウズエイト',
  'Windows 7': 'ウィンドウズセブン',
  'Windows': 'ウィンドウズ',
  'Linux': 'リナックス',
  'Ubuntu': 'ウブントゥ',
  'macOS': 'マックオーエス',
  'iOS': 'アイオーエス',
  'Android': 'アンドロイド',
  'Docker': 'ドッカー',
  'API': 'エーピーアイ',
  'SDK': 'エスディーケー',
  'IDE': 'アイディーイー',
  'GUI': 'ジーユーアイ',
  'CUI': 'シーユーアイ',
  'CLI': 'シーエルアイ',
  'SQL': 'エスキューエル',
  'NoSQL': 'ノーエスキューエル',
  // --- AI・データサイエンス ---
  'AI': 'エーアイ',
  'ML': 'エムエル',
  'DNN': 'ディーエヌエヌ',
  'CNN': 'シーエヌエヌ',
  'RNN': 'アールエヌエヌ',
  'LLM': 'エルエルエム',
  'GPT-4o': 'ジーピーティーフォーオー',
  'GPT-4': 'ジーピーティーフォー',
  'GPT-3.5': 'ジーピーティースリーポイントファイブ',
  'GPT': 'ジーピーティー',
  'ChatGPT': 'チャットジーピーティー',
  'Gemini 1.5': 'ジェミニいってんご',
  'Gemini': 'ジェミニ',
  'Claude 3.5': 'クロードスリーポイントファイブ',
  'Claude 3': 'クロードスリー',
  'Claude': 'クロード',
  'DALL-E': 'ダリ',
  'Llama 3': 'ラマスリー',
  'Llama 2': 'ラマツー',
  'SD3': 'エスディースリー',
  'SDXL': 'エスディーエックスエル',
  'Midjourney': 'ミッドジャーニー',
  // --- SNS・サービス ---
  'SNS': 'エスエヌエス',
  'DM': 'ディーエム',
  'YouTube': 'ユーチューブ',
  'Twitter': 'ツイッター',
  'Instagram': 'インスタグラム',
  'TikTok': 'ティックトック',
  'Discord': 'ディスコード',
  'Slack': 'スラック',
  'GitHub': 'ギットハブ',
  'Git': 'ギット',
  // --- Web・開発 ---
  'HTML': 'エイチティーエムエル',
  'CSS': 'シーエスエス',
  'JavaScript': 'ジャバスクリプト',
  'TypeScript': 'タイプスクリプト',
  'Python': 'パイソン',
  'React': 'リアクト',
  'Vue': 'ビュー',
  'Node.js': 'ノードジェイエス',
  'npm': 'エヌピーエム',
  'JSON': 'ジェイソン',
  'XML': 'エックスエムエル',
  'YAML': 'ヤムル',
  'JWT': 'ジェイダブリューティー',
  'OAuth': 'オーオース',
  'REST': 'レスト',
  'GraphQL': 'グラフキューエル',
  'WebSocket': 'ウェブソケット',
  // --- セキュリティ ---
  'SSL': 'エスエスエル',
  'TLS': 'ティーエルエス',
  'AES': 'エーイーエス',
  'RSA': 'アールエスエー',
  'VPN': 'ブイピーエヌ',
  '2FA': '二段階認証',
  'MFA': 'エムエフエー',
  'DDoS': 'ディードス',
  // --- ビジネス・一般IT ---
  'SaaS': 'サース',
  'PaaS': 'パース',
  'IaaS': 'イアース',
  'CRM': 'シーアールエム',
  'ERP': 'イーアールピー',
  'KPI': 'ケーピーアイ',
  'ROI': 'アールオーアイ',
  'PDF': 'ピーディーエフ',
  'FAQ': 'エフエーキュー',
  'QA': 'キューエー',
  'UI': 'ユーアイ',
  'UX': 'ユーエックス',
  'PR': 'ピーアール',
  'MVP': 'エムブイピー',
  'PoC': 'ピーオーシー',
  'OEM': 'オーイーエム',
  'B2B': 'ビートゥービー',
  'B2C': 'ビートゥーシー',
  'D2C': 'ディートゥーシー',
  // --- 単位・記号 ---
  'GB': 'ギガバイト',
  'TB': 'テラバイト',
  'MB': 'メガバイト',
  'KB': 'キロバイト',
  'GHz': 'ギガヘルツ',
  'MHz': 'メガヘルツ',
  'Gbps': 'ギガビーピーエス',
  'Mbps': 'メガビーピーエス',
  'fps': 'エフピーエス',
  '4K': 'よんケー',
  '8K': 'はちケー',
  'HDR': 'エイチディーアール',
  'VR': 'ブイアール',
  'AR': 'エーアール',
  'MR': 'エムアール',
  'XR': 'エックスアール',
  // --- ゲーム・エンタメ ---
  'FPS': 'エフピーエス',
  'RPG': 'アールピージー',
  'MMO': 'エムエムオー',
  'DLC': 'ディーエルシー',
  'NPC': 'エヌピーシー',
  'PvP': 'ピーブイピー',
  'PvE': 'ピーブイイー',
  'e-Sports': 'イースポーツ',
  'eSports': 'イースポーツ',
  'Steam': 'スチーム',
  'PS5 Pro': 'プレステファイブプロ',
  'PS5': 'プレステファイブ',
  'PS4': 'プレステフォー',
  'PS3': 'プレステスリー',
  'PS2': 'プレステツー',
  'PS1': 'プレステワン',
  'PS VR2': 'ピーエスブイアールツー',
  'PS': 'プレステ',
  'Switch 2': 'スイッチツー',
  'Switch2': 'スイッチツー',
  'Switch': 'スイッチ',
  'Xbox': 'エックスボックス',
  'Quest 3': 'クエストスリー',
  'Quest 2': 'クエストツー',
  'Vision Pro': 'ビジョンプロ',
  'Steam Deck': 'スチームデック',
  'ROG Ally': 'アールオージーアライ',
  'R18': 'アールじゅうはち',
  'R-18': 'アールじゅうはち',
  'R15': 'アールじゅうご',
  'R-15': 'アールじゅうご',
  'PG12': 'ピージーじゅうに',
  '1UP': 'ワンアップ',
  '1up': 'ワンアップ',
  '1P': 'ワンピー',
  '2P': 'ツーピー',
  '3P': 'スリーピー',
  '4P': 'フォーピー',
  '1on1': 'ワンオンワン',
  '3on3': 'スリーオンスリー',
  '1v1': 'ワンブイワン',
  '5v5': 'ファイブブイファイブ',
  '2ch': 'にちゃんねる',
  '5ch': 'ごちゃんねる',
  '777': 'スリーセブン',
  'C104': 'コミケひゃくよん',
  'C103': 'コミケひゃくさん',
  'C102': 'コミケひゃくに',
  'C101': 'コミケひゃくいち',
  'C100': 'コミケひゃく',
  'LEVEL5': 'レベルファイブ',
  'LEVEL0': 'レベルゼロ',
  'LEVEL1': 'レベルワン',
  'LEVEL2': 'レベルツー',
  'LEVEL3': 'レベルスリー',
  'LEVEL4': 'レベルフォー',
  'LEVEL6': 'レベルシックス',
  '2D': 'ツーディー',
  '3D': 'スリーディー',
  '4D': 'フォーディー',
  '5D': 'ファイブディー',
  '2.5D': 'にてんごディー',
  '2.5次元': 'にてんごじげん',
  '4DX': 'フォーディーエックス',
  'MX4D': 'エムエックスフォーディー',
  '3DCG': 'スリーディーシージー',
  '2DCG': 'ツーディーシージー',
  'VRChat': 'ブイアールチャット',
  // --- 日常会話・感情表現 ---
  'OK': 'オーケー',
  'NG': 'エヌジー',
  'No': 'ノー',
  'Yes': 'イエス',
  'Sorry': 'ソーリー',
  'Thank you': 'サンキュー',
  'Thanks': 'サンクス',
  'Please': 'プリーズ',
  'Hello': 'ハロー',
  'Bye': 'バイバイ',
  'Good': 'グッド',
  'Nice': 'ナイス',
  'Cool': 'クール',
  'Cute': 'キュート',
  'Love': 'ラブ',
  'Happy': 'ハッピー',
  'Lucky': 'ラッキー',
  'Chance': 'チャンス',
  'Trouble': 'トラブル',
  'Shock': 'ショック',
  'Panic': 'パニック',
  'Stress': 'ストレス',
  'Help': 'ヘルプ',
  'Miss': 'ミス',
  'Out': 'アウト',
  'Safe': 'セーフ',
  'Clear': 'クリア',
  'Game': 'ゲーム',
  'Winner': 'ウィナー',
  'Loser': 'ルーザー',
  'Challenge': 'チャレンジ',
  'Fight': 'ファイト',
  'Goal': 'ゴール',
  'Start': 'スタート',
  'Stop': 'ストップ',
  'End': 'エンド',
  'Final': 'ファイナル',
  'Bonus': 'ボーナス',
  'Special': 'スペシャル',
  'Super': 'スーパー',
  'Mega': 'メガ',
  'Ultra': 'ウルトラ',
  'Max': 'マックス',
  'Level': 'レベル',
  'Point': 'ポイント',
  'Score': 'スコア',
  'Rank': 'ランク',
  'Class': 'クラス',
  'Team': 'チーム',
  'Member': 'メンバー',
  'Leader': 'リーダー',
  'Partner': 'パートナー',
  'Friend': 'フレンド',
  'Rival': 'ライバル',
  'Hero': 'ヒーロー',
  'Monster': 'モンスター',
  'Boss': 'ボス',
  'Power': 'パワー',
  'Energy': 'エナジー',
  'Magic': 'マジック',
  'Secret': 'シークレット',
  'Mystery': 'ミステリー',
  'Surprise': 'サプライズ',
  'Present': 'プレゼント',
  'Event': 'イベント',
  'Party': 'パーティー',
  'Festival': 'フェスティバル',
  'Live': 'ライブ',
  'Show': 'ショー',
  'Stage': 'ステージ',
  'Debut': 'デビュー',
  'Idol': 'アイドル',
  'Fan': 'ファン',
  // --- 学校・教育 ---
  'Test': 'テスト',
  'Quiz': 'クイズ',
  'Homework': 'ホームワーク',
  'Note': 'ノート',
  'Pen': 'ペン',
  'Lesson': 'レッスン',
  'Schedule': 'スケジュール',
  'Club': 'クラブ',
  'Circle': 'サークル',
  // --- 食べ物・飲み物 ---
  'Coffee': 'コーヒー',
  'Tea': 'ティー',
  'Cake': 'ケーキ',
  'Cookie': 'クッキー',
  'Chocolate': 'チョコレート',
  'Cream': 'クリーム',
  'Cheese': 'チーズ',
  'Bread': 'ブレッド',
  'Salad': 'サラダ',
  'Pasta': 'パスタ',
  'Pizza': 'ピザ',
  'Burger': 'バーガー',
  'Sandwich': 'サンドイッチ',
  'Juice': 'ジュース',
  'Milk': 'ミルク',
  'Beer': 'ビール',
  'Wine': 'ワイン',
  'Cocktail': 'カクテル',
  'Menu': 'メニュー',
  'Restaurant': 'レストラン',
  'Cafe': 'カフェ',
  'Bar': 'バー',
  // --- ファッション・美容 ---
  'Fashion': 'ファッション',
  'Style': 'スタイル',
  'Design': 'デザイン',
  'Brand': 'ブランド',
  'Size': 'サイズ',
  'Color': 'カラー',
  'Pink': 'ピンク',
  'Blue': 'ブルー',
  'Red': 'レッド',
  'Green': 'グリーン',
  'White': 'ホワイト',
  'Black': 'ブラック',
  'Gold': 'ゴールド',
  'Silver': 'シルバー',
  'Diamond': 'ダイヤモンド',
  'Ring': 'リング',
  'Dress': 'ドレス',
  'Shirt': 'シャツ',
  'Shoes': 'シューズ',
  'Bag': 'バッグ',
  'Hair': 'ヘアー',
  'Make': 'メイク',
  'Nail': 'ネイル',
  'Spa': 'スパ',
  'Diet': 'ダイエット',
  'Gym': 'ジム',
  'Yoga': 'ヨガ',
  // --- 音楽 ---
  'Music': 'ミュージック',
  'Song': 'ソング',
  'Vocal': 'ボーカル',
  'Guitar': 'ギター',
  'Piano': 'ピアノ',
  'Drum': 'ドラム',
  'Bass': 'ベース',
  'Rock': 'ロック',
  'Pop': 'ポップ',
  'Jazz': 'ジャズ',
  'Hip-Hop': 'ヒップホップ',
  'Rap': 'ラップ',
  'DJ': 'ディージェイ',
  'CD': 'シーディー',
  'MV': 'エムブイ',
  'PV': 'ピーブイ',
  'BGM': 'ビージーエム',
  'SE': 'エスイー',
  'MC': 'エムシー',
  'Remix': 'リミックス',
  'Album': 'アルバム',
  'Single': 'シングル',
  'Tour': 'ツアー',
  'Concert': 'コンサート',
  // --- スポーツ ---
  'Sports': 'スポーツ',
  'Soccer': 'サッカー',
  'Baseball': 'ベースボール',
  'Basketball': 'バスケットボール',
  'Tennis': 'テニス',
  'Golf': 'ゴルフ',
  'Boxing': 'ボクシング',
  'Swimming': 'スイミング',
  'Running': 'ランニング',
  'Training': 'トレーニング',
  'Match': 'マッチ',
  'Cup': 'カップ',
  'MVP': 'エムブイピー',
  'Ace': 'エース',
  // --- 乗り物・交通 ---
  'Car': 'カー',
  'Bus': 'バス',
  'Taxi': 'タクシー',
  'Bike': 'バイク',
  'Truck': 'トラック',
  'SUV': 'エスユーブイ',
  'EV': 'イーブイ',
  'GPS': 'ジーピーエス',
  'ETC': 'イーティーシー',
  'Drive': 'ドライブ',
  'Speed': 'スピード',
  'Engine': 'エンジン',
  // --- 医療・健康 ---
  'Doctor': 'ドクター',
  'Nurse': 'ナース',
  'Hospital': 'ホスピタル',
  'Clinic': 'クリニック',
  'Virus': 'ウイルス',
  'Allergy': 'アレルギー',
  'Mask': 'マスク',
  'Vitamin': 'ビタミン',
  'Mental': 'メンタル',
  'Care': 'ケア',
  'Check': 'チェック',
  'Risk': 'リスク',
  'PCR': 'ピーシーアール',
  'CT': 'シーティー',
  'MRI': 'エムアールアイ',
  'DNA': 'ディーエヌエー',
  // --- ネットスラング・若者言葉 ---
  'SNS': 'エスエヌエス',
  'LINE': 'ライン',
  'Google': 'グーグル',
  'Amazon': 'アマゾン',
  'Apple': 'アップル',
  'iPhone 16': 'アイフォンじゅうろく',
  'iPhone16': 'アイフォンじゅうろく',
  'iPhone 15': 'アイフォンじゅうご',
  'iPhone15': 'アイフォンじゅうご',
  'iPhone 14': 'アイフォンじゅうよん',
  'iPhone14': 'アイフォンじゅうよん',
  'iPhone 13': 'アイフォンじゅうさん',
  'iPhone13': 'アイフォンじゅうさん',
  'iPhone': 'アイフォン',
  'iPad Pro': 'アイパッドプロ',
  'iPad Air': 'アイパッドエアー',
  'iPad mini': 'アイパッドミニ',
  'iPad': 'アイパッド',
  'Apple Watch': 'アップルウォッチ',
  'Mac': 'マック',
  'Netflix': 'ネットフリックス',
  'Uber': 'ウーバー',
  'PayPay': 'ペイペイ',
  'QR': 'キューアール',
  'App': 'アプリ',
  'Link': 'リンク',
  'Login': 'ログイン',
  'Logout': 'ログアウト',
  'Password': 'パスワード',
  'Account': 'アカウント',
  'Follow': 'フォロー',
  'Like': 'ライク',
  'Share': 'シェア',
  'Subscribe': 'サブスクライブ',
  'Trend': 'トレンド',
  'Viral': 'バイラル',
  'Meme': 'ミーム',
  'Hashtag': 'ハッシュタグ',
  'Selfie': 'セルフィー',
  'Cosplay': 'コスプレ',
  'Anime': 'アニメ',
  'Manga': 'マンガ',
  'Otaku': 'オタク',
  'Vtuber': 'ブイチューバー',
  'VTuber': 'ブイチューバー',
  'YouTuber': 'ユーチューバー',
  // --- ビジネス・仕事 ---
  'Office': 'オフィス',
  'Meeting': 'ミーティング',
  'Project': 'プロジェクト',
  'Report': 'レポート',
  'Presentation': 'プレゼンテーション',
  'Mail': 'メール',
  'E-mail': 'イーメール',
  'Deadline': 'デッドライン',
  'Overtime': 'オーバータイム',
  'Remote': 'リモート',
  'Online': 'オンライン',
  'Offline': 'オフライン',
  'Free': 'フリー',
  'Premium': 'プレミアム',
  'Plan': 'プラン',
  'Cost': 'コスト',
  'Budget': 'バジェット',
  'Sale': 'セール',
  'Discount': 'ディスカウント',
  'Campaign': 'キャンペーン',
  'Coupon': 'クーポン',
  'Cashless': 'キャッシュレス',
  'Credit': 'クレジット',
  // --- 住居・生活 ---
  'Room': 'ルーム',
  'House': 'ハウス',
  'Mansion': 'マンション',
  'Apartment': 'アパート',
  'Hotel': 'ホテル',
  'Kitchen': 'キッチン',
  'Toilet': 'トイレ',
  'Bath': 'バス',
  'Shower': 'シャワー',
  'Garden': 'ガーデン',
  'Balcony': 'バルコニー',
  'Door': 'ドア',
  'Key': 'キー',
  'Lock': 'ロック',
  'Light': 'ライト',
  'Air': 'エアー',
  'Cleaner': 'クリーナー',
  'Robot': 'ロボット',
  'Smart': 'スマート',
  'Eco': 'エコ',
  'Recycle': 'リサイクル',
  // --- 天気・自然 ---
  'Weather': 'ウェザー',
  'Storm': 'ストーム',
  'Hurricane': 'ハリケーン',
  'Season': 'シーズン',
  'Summer': 'サマー',
  'Winter': 'ウィンター',
  'Spring': 'スプリング',
  'Autumn': 'オータム',
  'Nature': 'ネイチャー',
  'Animal': 'アニマル',
  'Pet': 'ペット',
  'Cat': 'キャット',
  'Dog': 'ドッグ',
  // --- 漫画・アニメ特有表現 ---
  'VS': 'バーサス',
  'vs': 'バーサス',
  'KO': 'ケーオー',
  'HP': 'エイチピー',
  'MP': 'エムピー',
  'EXP': 'エクスペリエンス',
  'SP': 'エスピー',
  'OP': 'オープニング',
  'ED': 'エンディング',
  'CV': 'シーブイ',
  'SS': 'エスエス',
  'SSR': 'エスエスアール',
  'SR': 'エスアール',
  'UR': 'ユーアール',
  'GG': 'ジージー',
  'OMG': 'オーエムジー',
  'LOL': 'エルオーエル',
  'RIP': 'アールアイピー',
  'ASAP': 'エーエスエーピー',
  'DIY': 'ディーアイワイ',
  'PDCA': 'ピーディーシーエー',
  'SDGs': 'エスディージーズ',
  'NGO': 'エヌジーオー',
  'NPO': 'エヌピーオー',
  'CEO': 'シーイーオー',
  'CTO': 'シーティーオー',
  'IT': 'アイティー',
  'DX': 'ディーエックス',
  'ICT': 'アイシーティー',
  'Webtoon': 'ウェブトーン',
  'Web': 'ウェブ',
  'Site': 'サイト',
  'Blog': 'ブログ',
  'Podcast': 'ポッドキャスト',
  'Streaming': 'ストリーミング',
  'Download': 'ダウンロード',
  'Upload': 'アップロード',
  'Update': 'アップデート',
  'Install': 'インストール',
  'Delete': 'デリート',
  'Copy': 'コピー',
  'Paste': 'ペースト',
  'Save': 'セーブ',
  'Load': 'ロード',
  'Reset': 'リセット',
  'Reboot': 'リブート',
  'Error': 'エラー',
  'Bug': 'バグ',
  'Hack': 'ハック',
  'Spam': 'スパム',
  'Fake': 'フェイク',
  'News': 'ニュース',
  'Media': 'メディア',
  'Data': 'データ',
  'Cloud': 'クラウド',
  'Server': 'サーバー',
  'System': 'システム',
  'Network': 'ネットワーク',
  'Security': 'セキュリティ',
  'Privacy': 'プライバシー',
  'Backup': 'バックアップ',
  'File': 'ファイル',
  'Folder': 'フォルダ',
  'Display': 'ディスプレイ',
  'Monitor': 'モニター',
  'Printer': 'プリンター',
  'Scanner': 'スキャナー',
  'Camera': 'カメラ',
  'Video': 'ビデオ',
  'Photo': 'フォト',
  'Image': 'イメージ',
  'Pixel': 'ピクセル',
  'Font': 'フォント',
  'Icon': 'アイコン',
  'Logo': 'ロゴ',
  'Theme': 'テーマ',
  'Template': 'テンプレート',
  'Tutorial': 'チュートリアル',
  'Manual': 'マニュアル',
  'Guide': 'ガイド',
  'Version': 'バージョン',
  'Beta': 'ベータ',
  'Alpha': 'アルファ',
  'Pro': 'プロ',
  'Lite': 'ライト',
  'Mini': 'ミニ',
  'Plus': 'プラス',
  // --- 数字付きミリタリー・SF・サイエンス・一般 ---
  'F-15': 'エフじゅうご',
  'F15': 'エフじゅうご',
  'F-16': 'エフじゅうろく',
  'F16': 'エフじゅうろく',
  'F-22': 'エフにじゅうに',
  'F22': 'エフにじゅうに',
  'F-35': 'エフさんじゅうご',
  'F35': 'エフさんじゅうご',
  'AK-47': 'エーケーよんなな',
  'AK47': 'エーケーよんなな',
  'M16': 'エムじゅうろく',
  'RPG-7': 'アールピージーセブン',
  'RPG7': 'アールピージーセブン',
  'T-34': 'ティーさんじゅうよん',
  'T34': 'ティーさんじゅうよん',
  'C-3PO': 'シースリーピーオー',
  'R2-D2': 'アールツーディーツー',
  '007': 'ダブルオーセブン',
  'CO2': 'シーオーツー',
  'H2O': 'エイチツーオー',
  'O157': 'オーいちごなな',
  'PM2.5': 'ピーエムにーてんご',
  'A4': 'エーよん',
  'A3': 'エーさん',
  'B5': 'ビーご',
  'B4': 'ビーよん',
  // --- 素材サイト・ストックフォト ---
  'PIXTA': 'ピクスタ',
  'Shutterstock': 'シャッターストック',
  'iStock': 'アイストック',
  'Adobe Stock': 'アドビストック',
  'Getty Images': 'ゲッティイメージズ',
  'Unsplash': 'アンスプラッシュ',
  'Pexels': 'ペクセルズ',
  'Freepik': 'フリーピック',
  'Dreamstime': 'ドリームスタイム',
  // --- 出版・メディア企業 ---
  'KADOKAWA': 'カドカワ',
  'Shueisha': 'シュウエイシャ',
  'Kodansha': 'コウダンシャ',
  'Shogakukan': 'ショウガクカン',
  'JUMP': 'ジャンプ',
  'Gangan': 'ガンガン',
  'Comiket': 'コミケット',
  'Comico': 'コミコ',
  'LINE Manga': 'ラインマンガ',
  'pixiv': 'ピクシブ',
  'Booth': 'ブース',
  'DLsite': 'ディーエルサイト',
  'FANZA': 'ファンザ',
  'Fantia': 'ファンティア',
  'Patreon': 'パトレオン',
  // --- テック企業・ブランド ---
  'NVIDIA': 'エヌビディア',
  'GeForce': 'ジーフォース',
  'Radeon': 'レイディオン',
  'AMD': 'エーエムディー',
  'Intel': 'インテル',
  'Qualcomm': 'クアルコム',
  'Snapdragon': 'スナップドラゴン',
  'Tesla': 'テスラ',
  'SpaceX': 'スペースエックス',
  'Meta': 'メタ',
  'Microsoft': 'マイクロソフト',
  'Samsung': 'サムスン',
  'Huawei': 'ファーウェイ',
  'Xiaomi': 'シャオミ',
  'ASUS': 'エイスース',
  'Lenovo': 'レノボ',
  'Dell': 'デル',
  'HP': 'エイチピー',
  'IBM': 'アイビーエム',
  'Oracle': 'オラクル',
  'Cisco': 'シスコ',
  'Salesforce': 'セールスフォース',
  'SAP': 'エスエーピー',
  'Zoom': 'ズーム',
  'Teams': 'チームズ',
  // --- デザイン・クリエイティブツール ---
  'Canva': 'キャンバ',
  'Figma': 'フィグマ',
  'Photoshop': 'フォトショップ',
  'Illustrator': 'イラストレーター',
  'Premiere': 'プレミア',
  'Blender': 'ブレンダー',
  'Unity': 'ユニティ',
  'Unreal Engine': 'アンリアルエンジン',
  'Unreal': 'アンリアル',
  'Godot': 'ゴドー',
  'CLIP STUDIO': 'クリップスタジオ',
  'CLIP': 'クリップ',
  'Procreate': 'プロクリエイト',
  'Notion': 'ノーション',
  'Trello': 'トレロ',
  // --- 配信・エンタメサービス ---
  'Hulu': 'フールー',
  'Twitch': 'トゥイッチ',
  'Spotify': 'スポティファイ',
  'Crunchyroll': 'クランチロール',
  'Disney Plus': 'ディズニープラス',
  'Prime Video': 'プライムビデオ',
  'Abema': 'アベマ',
  'AbemaTV': 'アベマティービー',
  'niconico': 'ニコニコ',
  'DAZN': 'ダゾーン',
  'U-NEXT': 'ユーネクスト',
  'Kindle': 'キンドル',
  'Audible': 'オーディブル',
  // --- ゲームタイトル ---
  'Fortnite': 'フォートナイト',
  'Minecraft': 'マインクラフト',
  'Apex Legends': 'エーペックスレジェンズ',
  'Apex': 'エーペックス',
  'Valorant': 'ヴァロラント',
  'Genshin': 'ゲンシン',
  'Splatoon': 'スプラトゥーン',
  'Zelda': 'ゼルダ',
  'Pokemon': 'ポケモン',
  'Mario': 'マリオ',
  'Final Fantasy': 'ファイナルファンタジー',
  'Dragon Quest': 'ドラゴンクエスト',
  'Monster Hunter': 'モンスターハンター',
  'Dark Souls': 'ダークソウル',
  'Elden Ring': 'エルデンリング',
  'Roblox': 'ロブロックス',
  'Among Us': 'アモングアス',
  'League of Legends': 'リーグオブレジェンズ',
  'Overwatch': 'オーバーウォッチ',
  'Call of Duty': 'コールオブデューティー',
  // --- 自動車・モビリティ ---
  'Toyota': 'トヨタ',
  'Honda': 'ホンダ',
  'Nissan': 'ニッサン',
  'Mazda': 'マツダ',
  'Subaru': 'スバル',
  'Suzuki': 'スズキ',
  'BMW': 'ビーエムダブリュー',
  'Mercedes': 'メルセデス',
  'Porsche': 'ポルシェ',
  'Ferrari': 'フェラーリ',
  'Lamborghini': 'ランボルギーニ',
  // --- 金融・決済 ---
  'PayPal': 'ペイパル',
  'Stripe': 'ストライプ',
  'Bitcoin': 'ビットコイン',
  'Ethereum': 'イーサリアム',
  'NFT': 'エヌエフティー',
  'DAO': 'ダオ',
  'DeFi': 'ディーファイ',
  'NISA': 'ニーサ',
  'iDeCo': 'イデコ',
  'FIRE': 'ファイア',
  'FX': 'エフエックス',
  'ETF': 'イーティーエフ',
  // --- 教育・資格 ---
  'TOEIC': 'トーイック',
  'TOEFL': 'トーフル',
  'IELTS': 'アイエルツ',
  'MBA': 'エムビーエー',
  'PhD': 'ピーエイチディー',
  'STEM': 'ステム',
};

// ── 日本語→日本語 読み辞書 (VOICEVOX発音補正用) ──
// OpenJTalk/MeCab形態素解析が誤読しやすい漢字・熟語をひらがなに事前変換する
// ※ 完全一致（単語境界考慮）で置換
// ※ 同形異義語（行って、生 等）は文脈依存のためVOICEVOX内部に委ねる
const JP_READING_DICT = {
  // ── カテゴリ1: 難読漢字・熟語 ──
  '齟齬': 'そご',
  '贖罪': 'しょくざい',
  '蹉跌': 'さてつ',
  '忸怩': 'じくじ',
  '邂逅': 'かいこう',
  '蹂躙': 'じゅうりん',
  '慟哭': 'どうこく',
  '咆哮': 'ほうこう',
  '嚥下': 'えんげ',
  '逡巡': 'しゅんじゅん',
  '矜持': 'きょうじ',
  '僭越': 'せんえつ',
  '蹲踞': 'そんきょ',
  '喧噪': 'けんそう',
  '齢': 'よわい',
  '訃報': 'ふほう',
  '語彙': 'ごい',
  '瓦礫': 'がれき',
  '憐憫': 'れんびん',
  '怨嗟': 'えんさ',
  '慚愧': 'ざんき',
  '彷徨': 'ほうこう',
  '咀嚼': 'そしゃく',
  '凄惨': 'せいさん',
  '獰猛': 'どうもう',
  '怒髪天': 'どはつてん',
  '魑魅魍魎': 'ちみもうりょう',
  '侃々諤々': 'かんかんがくがく',
  '傀儡': 'かいらい',
  '蠱惑': 'こわく',
  '跋扈': 'ばっこ',
  '瀟洒': 'しょうしゃ',
  '狼狽': 'ろうばい',
  '畏怖': 'いふ',
  '憤懣': 'ふんまん',
  '諧謔': 'かいぎゃく',
  '揶揄': 'やゆ',
  '倦怠': 'けんたい',
  '彗星': 'すいせい',
  '瞠目': 'どうもく',
  '蛮行': 'ばんこう',
  '驚愕': 'きょうがく',
  '鷹揚': 'おうよう',
  '暗澹': 'あんたん',
  '韜晦': 'とうかい',
  '糊口': 'ここう',
  '忖度': 'そんたく',
  '饒舌': 'じょうぜつ',
  '矛盾': 'むじゅん',
  '辟易': 'へきえき',

  // ── カテゴリ2: 読み間違いやすい熟語 ──
  '重複': 'ちょうふく',
  '代替': 'だいたい',
  '早急': 'さっきゅう',
  '相殺': 'そうさい',
  '遵守': 'じゅんしゅ',
  '発足': 'ほっそく',
  '進捗': 'しんちょく',
  '汎用': 'はんよう',
  '他人事': 'ひとごと',
  '破綻': 'はたん',
  '添付': 'てんぷ',
  '貼付': 'ちょうふ',
  '過不足': 'かふそく',
  '肉汁': 'にくじゅう',
  '一段落': 'いちだんらく',
  '会釈': 'えしゃく',
  '逝去': 'せいきょ',
  '世論': 'よろん',
  '続柄': 'つづきがら',
  '出生': 'しゅっしょう',
  '施策': 'しさく',
  '凡例': 'はんれい',
  '依存': 'いぞん',
  '完遂': 'かんすい',
  '漸次': 'ぜんじ',
  '月極': 'つきぎめ',
  '境内': 'けいだい',
  '固執': 'こしつ',
  '廉価': 'れんか',
  '脆弱': 'ぜいじゃく',
  '均衡': 'きんこう',
  '暫定': 'ざんてい',
  '吃驚': 'びっくり',
  '流石': 'さすが',
  '所謂': 'いわゆる',
  '矢張り': 'やはり',
  '兎に角': 'とにかく',
  '出鱈目': 'でたらめ',
  '滅茶苦茶': 'めちゃくちゃ',
  '素敵': 'すてき',
  '可笑しい': 'おかしい',

  // ── カテゴリ3: 四字熟語（バトル・ファンタジー系） ──
  '一騎当千': 'いっきとうせん',
  '乾坤一擲': 'けんこんいってき',
  '疾風迅雷': 'しっぷうじんらい',
  '明鏡止水': 'めいきょうしすい',
  '不倶戴天': 'ふぐたいてん',
  '生殺与奪': 'せいさつよだつ',
  '猪突猛進': 'ちょとつもうしん',
  '百戦錬磨': 'ひゃくせんれんま',
  '千変万化': 'せんぺんばんか',
  '天衣無縫': 'てんいむほう',
  '神出鬼没': 'しんしゅつきぼつ',
  '電光石火': 'でんこうせっか',
  '獅子奮迅': 'ししふんじん',
  '怒涛万丈': 'どとうばんじょう',
  '呉越同舟': 'ごえつどうしゅう',
  '臥薪嘗胆': 'がしんしょうたん',
  '四面楚歌': 'しめんそか',
  '背水之陣': 'はいすいのじん',
  '一刀両断': 'いっとうりょうだん',
  '完全無欠': 'かんぜんむけつ',
  '風林火山': 'ふうりんかざん',
  '弱肉強食': 'じゃくにくきょうしょく',
  '切磋琢磨': 'せっさたくま',
  '捲土重来': 'けんどちょうらい',
  '大義名分': 'たいぎめいぶん',
  '因果応報': 'いんがおうほう',
  '勧善懲悪': 'かんぜんちょうあく',
  '天下無双': 'てんかむそう',
  '森羅万象': 'しんらばんしょう',
  '竜頭蛇尾': 'りゅうとうだび',
  '有象無象': 'うぞうむぞう',
  '魑魅魍魎': 'ちみもうりょう',
  '無我夢中': 'むがむちゅう',
  '一蓮托生': 'いちれんたくしょう',
  '言語道断': 'ごんごどうだん',
  '波瀾万丈': 'はらんばんじょう',
  '阿鼻叫喚': 'あびきょうかん',
  '玉石混交': 'ぎょくせきこんこう',
  '起死回生': 'きしかいせい',
  '孤軍奮闘': 'こぐんふんとう',

  // ── カテゴリ4: 四字熟語（日常・感情系） ──
  '七転八倒': 'しちてんばっとう',
  '五里霧中': 'ごりむちゅう',
  '一喜一憂': 'いっきいちゆう',
  '右往左往': 'うおうさおう',
  '試行錯誤': 'しこうさくご',
  '自業自得': 'じごうじとく',
  '喜怒哀楽': 'きどあいらく',
  '以心伝心': 'いしんでんしん',
  '一石二鳥': 'いっせきにちょう',
  '十人十色': 'じゅうにんといろ',
  '一期一会': 'いちごいちえ',
  '青天霹靂': 'せいてんへきれき',
  '意気投合': 'いきとうごう',
  '悪戦苦闘': 'あくせんくとう',
  '四苦八苦': 'しくはっく',
  '自暴自棄': 'じぼうじき',
  '品行方正': 'ひんこうほうせい',
  '質実剛健': 'しつじつごうけん',
  '天真爛漫': 'てんしんらんまん',
  '温故知新': 'おんこちしん',
  '唯我独尊': 'ゆいがどくそん',
  '傍若無人': 'ぼうじゃくぶじん',
  '厚顔無恥': 'こうがんむち',
  '馬耳東風': 'ばじとうふう',
  '針小棒大': 'しんしょうぼうだい',
  '異口同音': 'いくどうおん',
  '我田引水': 'がでんいんすい',
  '付和雷同': 'ふわらいどう',
  '喧喧囂囂': 'けんけんごうごう',
  '意気消沈': 'いきしょうちん',

  // ── カテゴリ5: 古語・文語調 ──
  '汝': 'なんじ',
  '我が': 'わが',
  '其の': 'その',
  '何故': 'なぜ',
  '如何': 'いかが',
  '如何に': 'いかに',
  '如何なる': 'いかなる',
  '然り': 'しかり',
  '然し': 'しかし',
  '然も': 'しかも',
  '即ち': 'すなわち',
  '故に': 'ゆえに',
  '畢竟': 'ひっきょう',
  '所以': 'ゆえん',
  '些か': 'いささか',
  '悉く': 'ことごとく',
  '甚だ': 'はなはだ',
  '概ね': 'おおむね',
  '頗る': 'すこぶる',
  '凡そ': 'およそ',
  '殆ど': 'ほとんど',
  '尤も': 'もっとも',
  '寧ろ': 'むしろ',
  '偏に': 'ひとえに',
  '専ら': 'もっぱら',
  '漸く': 'ようやく',
  '辛うじて': 'かろうじて',
  '強いて': 'しいて',
  '況や': 'いわんや',
  '蓋し': 'けだし',

  // ── カテゴリ6: 漫画特有語彙 ──
  '覚醒': 'かくせい',
  '結界': 'けっかい',
  '詠唱': 'えいしょう',
  '魔力': 'まりょく',
  '必殺技': 'ひっさつわざ',
  '召喚': 'しょうかん',
  '封印': 'ふういん',
  '転生': 'てんせい',
  '異世界': 'いせかい',
  '魔王': 'まおう',
  '勇者': 'ゆうしゃ',
  '聖剣': 'せいけん',
  '暗殺': 'あんさつ',
  '暗黒': 'あんこく',
  '殲滅': 'せんめつ',
  '粛清': 'しゅくせい',
  '浄化': 'じょうか',
  '降臨': 'こうりん',
  '顕現': 'けんげん',
  '神託': 'しんたく',
  '呪術': 'じゅじゅつ',
  '呪詛': 'じゅそ',
  '呪縛': 'じゅばく',
  '刹那': 'せつな',
  '無双': 'むそう',
  '修羅場': 'しゅらば',
  '死闘': 'しとう',
  '激闘': 'げきとう',
  '死神': 'しにがみ',
  '鬼神': 'きしん',
  '妖怪': 'ようかい',
  '妖精': 'ようせい',
  '精霊': 'せいれい',
  '使い魔': 'つかいま',
  '錬金術': 'れんきんじゅつ',
  '錬成': 'れんせい',
  '変身': 'へんしん',
  '合体': 'がったい',
  '究極': 'きゅうきょく',
  '最強': 'さいきょう',

  // ── カテゴリ7: 一般誤読頻出語 ──
  '雰囲気': 'ふんいき',
  '体裁': 'ていさい',
  '容赦': 'ようしゃ',
  '生業': 'なりわい',
  '名残': 'なごり',
  '風情': 'ふぜい',
  '仲人': 'なこうど',
  '素人': 'しろうと',
  '玄人': 'くろうと',
  '大人': 'おとな',
  '一人': 'ひとり',
  '二人': 'ふたり',
  '下手': 'へた',
  '上手': 'じょうず',
  '仕草': 'しぐさ',
  '台詞': 'せりふ',
  '科白': 'せりふ',
  '眼鏡': 'めがね',
  '煙草': 'たばこ',
  '土産': 'みやげ',
  '時雨': 'しぐれ',
  '梅雨': 'つゆ',
  '五月雨': 'さみだれ',
  '紅葉': 'もみじ',
  '吹雪': 'ふぶき',
  '海老': 'えび',
  '河豚': 'ふぐ',
  '秋刀魚': 'さんま',
  '心太': 'ところてん',
  '若人': 'わこうど',

  // ── カテゴリ8: 感情・擬態語 ──
  '号泣': 'ごうきゅう',
  '激怒': 'げきど',
  '戦慄': 'せんりつ',
  '困惑': 'こんわく',
  '歓喜': 'かんき',
  '恐怖': 'きょうふ',
  '絶望': 'ぜつぼう',
  '憤怒': 'ふんぬ',
  '嫉妬': 'しっと',
  '落胆': 'らくたん',
  '動揺': 'どうよう',
  '呆然': 'ぼうぜん',
  '茫然': 'ぼうぜん',
  '唖然': 'あぜん',
  '愕然': 'がくぜん',
  '陶酔': 'とうすい',
  '恍惚': 'こうこつ',
  '憧憬': 'どうけい',
  '郷愁': 'きょうしゅう',
  '哀愁': 'あいしゅう',
};

// ── 正規表現ベースの読み方補正ルール (VOICEVOX送信前テキスト正規化) ──
// 静的辞書では対応できない動的パターン（記号、伸ばし、重複等）を処理
const JP_READING_REGEX_RULES = [
  // 記号クリーニング: VOICEVOXに送ると不安定になる装飾記号を除去
  { pattern: /[♪♡♥★☆♠♦♣▼▲◆●■□△▽◇○◎※→←↑↓]/g, replacement: '' },
  // 三点リーダの正規化: 過剰な三点リーダや中黒連続を1つに
  { pattern: /…{2,}/g, replacement: '…' },
  { pattern: /・{3,}/g, replacement: '…' },
  // 感嘆符の正規化: 過剰な感嘆符・疑問符を1つに（VOICEVOXは1つで十分反映する）
  { pattern: /[！!]{2,}/g, replacement: '！' },
  { pattern: /[？?]{2,}/g, replacement: '？' },
  // 波ダッシュの正規化: 過剰な伸ばし記号を1つに
  { pattern: /[〜～ー]{3,}/g, replacement: 'ー' },
  // ひらがな連続の短縮: 同一ひらがなの4回以上の繰り返しを2回に短縮
  // 例: 「ああああああ」→「ああ」「えーーーっ」は上のルールでカバー
  { pattern: /([ぁ-ん])\1{3,}/g, replacement: '$1$1' },
  // カタカナ連続の短縮: 同一カタカナの4回以上の繰り返しを2回に短縮
  { pattern: /([ァ-ヴ])\1{3,}/g, replacement: '$1$1' },
];

// ── 英語辞書: 長いキーを先にマッチさせるためソート済みの正規表現パターンを構築 ──
// ※前後に英数字が存在しないことをルックアラウンドで保証し、部分一致（NEKO内のKOなど）を防ぐ
const PRONUNCIATION_KEYS = Object.keys(PRONUNCIATION_DICT)
  .sort((a, b) => b.length - a.length);
const PRONUNCIATION_REGEX = new RegExp(
  PRONUNCIATION_KEYS.map(k => `(?<![a-zA-Z0-9])${k.replace(/[-./\\^$*+?()[\]{}|]/g, '\\$&')}(?![a-zA-Z0-9])`).join('|'),
  'gi'
);

// ── 日本語辞書: 長いキーを先にマッチさせるためソート済みの正規表現パターンを構築 ──
const JP_READING_KEYS = Object.keys(JP_READING_DICT)
  .sort((a, b) => b.length - a.length);
const JP_READING_REGEX = new RegExp(
  JP_READING_KEYS.map(k => k.replace(/[-./\\^$*+?()[\]{}|]/g, '\\$&')).join('|'),
  'g'
);

/**
 * VOICEVOX送信前にテキストを3段階で前処理する:
 * (1) 正規表現パターン: 記号除去・伸ばし正規化
 * (2) 日本語辞書: 難読漢字・四字熟語・古語等をひらがなに変換
 * (3) 英語辞書: 英字略語・IT用語をカタカナ読みに変換
 */
function applyPronunciationDict(text, sessionId = null) {
  if (typeof text !== 'string') {
    text = String(text || '');
  }
  let result = text;

  // (1) 正規表現ベースの前処理（記号除去・伸ばし正規化）
  for (const rule of JP_READING_REGEX_RULES) {
    result = result.replace(rule.pattern, rule.replacement);
  }

  // (2) 日本語→ひらがな辞書（難読漢字・四字熟語・古語等）
  result = result.replace(JP_READING_REGEX, (match) => {
    return JP_READING_DICT[match] || match;
  });

  // (3) 英語→カタカナ辞書（既存の英字略語・IT用語変換、単語境界・代名詞ガード付き）
  result = result.replace(PRONUNCIATION_REGEX, (match) => {
    // 特別ルール: "IT" と代名詞 "It / it" の混同を防ぐ
    if (match.toLowerCase() === 'it') {
      if (match !== 'IT') {
        return match; // 大文字の IT でなければ置換しない
      }
    }
    const key = PRONUNCIATION_KEYS.find(k => k.toLowerCase() === match.toLowerCase());
    return key ? PRONUNCIATION_DICT[key] : match;
  });

  // 変更検知とログ出力
  if (result !== text && sessionId) {
    sessionLog(sessionId, `   📖 [Pronunciation] "${text}" ➔ "${result}"`);
  }

  return result;
}

// ── AI動的読み推定: 辞書にない英単語をAIに問い合わせてカタカナ読みを取得 ──
// セッション単位のキャッシュにより、同一動画内での重複API呼び出しを回避
const aiPronunciationCache = new Map(); // sessionId -> Map<word, katakana>

/**
 * テキスト中の辞書未登録英単語を検出し、AIにカタカナ読みを問い合わせる
 * @param {string} text - applyPronunciationDict適用済みのテキスト
 * @param {string} sessionId - セッションID
 * @returns {string} 英単語がカタカナに置換されたテキスト
 */
async function resolveUnknownEnglishWords(text, sessionId = null) {
  // APIキーが未設定の場合はスキップ（辞書のみで運用）
  const apiKey = runtimeApiKey || process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY || '';
  if (!apiKey) return text;

  // 辞書置換後に残っている英単語を検出（3文字以上の英字列）
  // ※ 1-2文字の英字（I, a, My, He等）は代名詞・冠詞の可能性が高いため除外
  // ※ カタカナに既に変換済みの部分は対象外
  const englishWordPattern = /(?<![a-zA-Z])([a-zA-Z]{3,}(?:[-'][a-zA-Z]+)*)(?![a-zA-Z])/g;
  const matches = [...text.matchAll(englishWordPattern)];
  if (matches.length === 0) return text;

  // 重複除去
  const uniqueWords = [...new Set(matches.map(m => m[1]))];

  // セッションキャッシュを取得（なければ作成）
  if (!aiPronunciationCache.has(sessionId)) {
    aiPronunciationCache.set(sessionId, new Map());
  }
  const cache = aiPronunciationCache.get(sessionId);

  // キャッシュにある単語を除外
  const uncachedWords = uniqueWords.filter(w => !cache.has(w.toLowerCase()));

  // 全てキャッシュ済みの場合はAPI呼び出し不要
  if (uncachedWords.length === 0) {
    let result = text;
    for (const word of uniqueWords) {
      const katakana = cache.get(word.toLowerCase());
      if (katakana) {
        result = result.replace(new RegExp(`(?<![a-zA-Z])${word.replace(/[-]/g, '\\$&')}(?![a-zA-Z])`, 'g'), katakana);
      }
    }
    if (result !== text && sessionId) {
      sessionLog(sessionId, `   🤖 [AI Pronunciation/cache] "${text}" ➔ "${result}"`);
    }
    return result;
  }

  // AIに問い合わせ
  try {
    const wordList = uncachedWords.join(', ');
    const aiPrompt = `以下の英単語・固有名詞の日本語での一般的なカタカナ読みを答えてください。
各単語のカタカナ読みだけをJSON形式で返してください。余計な説明は不要です。
形式: {"単語": "カタカナ読み", ...}

単語リスト: ${wordList}`;

    let responseText = '';

    if (runtimeEngine === 'openai') {
      const OpenAI = (await import('openai')).default;
      const openai = new OpenAI({ apiKey });
      // コスト最小のminiモデルを使用
      const response = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: "system", content: "あなたは英語の固有名詞の日本語読みに精通した言語学の専門家です。必ず指定されたJSON形式で出力してください。" },
          { role: "user", content: aiPrompt }
        ],
        response_format: { type: "json_object" },
        temperature: 0.0,
        max_tokens: 500
      }, { timeout: 10000 });
      responseText = response.choices[0].message.content;
    } else {
      // Gemini (Flashモデルでコスト最小化)
      const { GoogleGenerativeAI } = await import('@google/generative-ai');
      const genAI = new GoogleGenerativeAI(apiKey);
      // 読み推定には最軽量モデルで十分
      const pronunciationModels = ['gemini-2.0-flash-lite', 'gemini-2.0-flash', 'gemini-1.5-flash'];
      let aiResult = null;
      for (const modelName of pronunciationModels) {
        try {
          const model = genAI.getGenerativeModel({ model: modelName });
          const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error('AI pronunciation lookup timed out')), 10000)
          );
          aiResult = await Promise.race([model.generateContent(aiPrompt), timeoutPromise]);
          break;
        } catch (e) {
          // 次のモデルを試行
          continue;
        }
      }
      if (aiResult) {
        responseText = aiResult.response.text();
      }
    }

    // JSONパース（```json ... ``` ラッパーを除去してからパース）
    if (responseText) {
      const jsonStr = responseText.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
      const parsed = JSON.parse(jsonStr);

      // キャッシュに保存 & テキストに適用
      let result = text;
      for (const [word, katakana] of Object.entries(parsed)) {
        if (typeof katakana === 'string' && katakana.length > 0) {
          cache.set(word.toLowerCase(), katakana);
          // テキスト内の当該英単語をカタカナに置換（大文字小文字不問）
          const escapedWord = word.replace(/[-]/g, '\\$&');
          result = result.replace(new RegExp(`(?<![a-zA-Z])${escapedWord}(?![a-zA-Z])`, 'gi'), katakana);
        }
      }

      if (result !== text && sessionId) {
        sessionLog(sessionId, `   🤖 [AI Pronunciation] "${text}" ➔ "${result}" (${uncachedWords.length}語をAIで解決)`);
      }
      return result;
    }
  } catch (err) {
    // AI読み推定に失敗しても処理を止めない（辞書適用済みのテキストをそのまま返す）
    if (sessionId) {
      sessionLog(sessionId, `   ⚠️ [AI Pronunciation] AI読み推定失敗 (辞書のみで続行): ${err.message}`);
    }
  }

  return text;
}

/**
 * 発音補正の統合パイプライン:
 * (1) 静的辞書 (applyPronunciationDict) → 高速・確実・無料
 * (2) AI動的推定 (resolveUnknownEnglishWords) → 辞書にない固有名詞をAIで補完
 */
async function applyFullPronunciationPipeline(text, sessionId = null) {
  // Phase 1: 静的辞書による置換
  const dictApplied = applyPronunciationDict(text, sessionId);
  // Phase 2: 残った英単語をAIで動的に解決
  const fullyResolved = await resolveUnknownEnglishWords(dictApplied, sessionId);
  return fullyResolved;
}

// セッション終了時にAI読み推定キャッシュもクリーンアップ
function cleanupAiPronunciationCache(sessionId) {
  aiPronunciationCache.delete(sessionId);
}

const app = express();
const PORT = 3001;

// ミドルウェア
app.use(cors());
app.use(express.json());

// セッション管理用（インメモリ）
const sessions = new Map();

// ── パイプラインロック制御 (二重起動防止) ──
const LOCK_FILE = path.join(__dirname, '.pipeline_lock');

function acquireLock() {
  if (fs.existsSync(LOCK_FILE)) {
    return false;
  }
  fs.writeFileSync(LOCK_FILE, String(Date.now()), 'utf8');
  return true;
}

function releaseLock() {
  try {
    if (fs.existsSync(LOCK_FILE)) {
      fs.unlinkSync(LOCK_FILE);
    }
  } catch (e) {
    console.error('Failed to release lock file:', e);
  }
}

// ── ガベージコレクション (古い一時ファイルの自動削除) ──
const CLEANUP_DIRS = [
  path.join(__dirname, 'temp'),
  path.join(__dirname, 'out'),
  path.join(__dirname, 'public', 'panels'),
  path.join(__dirname, 'public', 'audio')
];
const MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24時間

function cleanupOldFiles() {
  console.log('🧹 [Garbage Collection] 24時間以上経過した古い一時ファイルをチェック中...');
  const now = Date.now();
  let deletedCount = 0;

  CLEANUP_DIRS.forEach(dir => {
    if (!fs.existsSync(dir)) return;
    try {
      const items = fs.readdirSync(dir);
      items.forEach(item => {
        if (item === '.gitkeep') return;
        const itemPath = path.join(dir, item);
        const stats = fs.statSync(itemPath);
        if (now - stats.mtimeMs > MAX_AGE_MS) {
          if (stats.isDirectory()) {
            fs.rmSync(itemPath, { recursive: true, force: true });
          } else {
            fs.unlinkSync(itemPath);
          }
          deletedCount++;
        }
      });
    } catch (err) {
      console.error(`  ❌ ${dir} のクリーンアップ中にエラー:`, err.message);
    }
  });

  // インメモリセッションデータの解放 (24時間以上前の古いセッションをMapから削除)
  let deletedSessions = 0;
  for (const [sid, sess] of sessions.entries()) {
    if (sess.createdAt && now - sess.createdAt > MAX_AGE_MS) {
      sessions.delete(sid);
      deletedSessions++;
    }
  }

  if (deletedCount > 0 || deletedSessions > 0) {
    console.log(`  ✨ お掃除完了！ ${deletedCount} 件のファイルと ${deletedSessions} 件の古いセッションメモリデータを削除し、容量を空けました。`);
  } else {
    console.log('  ✨ 削除対象の古いファイルおよびセッションデータはありませんでした（クリーンです）。');
  }
}

// サーバー起動時にお掃除を実行
cleanupOldFiles();
// 前回の異常終了によるロックファイルが残っていればクリーンアップ
try {
  if (fs.existsSync(LOCK_FILE)) {
    fs.unlinkSync(LOCK_FILE);
    console.log('🧹 [Startup] 前回の古い .pipeline_lock を削除しました。');
  }
} catch (e) {
  console.error('Failed to clean startup lock file:', e);
}
// 以降、1時間ごとに自動実行
setInterval(cleanupOldFiles, 60 * 60 * 1000);

// セッションごとのログ蓄積（フロントエンドポーリング用）
const sessionLogs = new Map();
function sessionLog(sessionId, message) {
  console.log(`[BE] ${message}`);
  if (!sessionLogs.has(sessionId)) sessionLogs.set(sessionId, []);
  sessionLogs.get(sessionId).push(message);
}

// 完了/エラー後のセッションログを5分後に自動削除（メモリリーク防止）
function scheduleLogCleanup(sessionId) {
  setTimeout(() => {
    sessionLogs.delete(sessionId);
    cleanupAiPronunciationCache(sessionId);
    // sessions.delete(sessionId); // 404エラー防止のためここでは削除せず、24時間後のガベージコレクション(cleanupOldFiles)に委ねる
    console.log(`🧹 [LogCleanup] セッション ${sessionId} のログを削除`);
  }, 5 * 60 * 1000);
}

const raw = fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8');
const pkg = JSON.parse(raw.replace(/^\uFEFF/, ''));
const SYSTEM_VERSION = pkg.version;

// ランタイムで設定されたAPIキー（.envより優先）
let runtimeApiKey = '';
let runtimeModel = 'gemini-3.5-flash';
let runtimeEngine = 'gemini';

// ファイルアップロード設定（画像のみ）
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const sessionId = `session_${Date.now()}`;
    const dir = path.join(__dirname, 'temp', sessionId);
    fs.mkdirSync(dir, { recursive: true });
    req.sessionId = sessionId;
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `source${ext}`);
  },
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    // 画像ファイルのみ許可
    if (/\.(png|jpg|jpeg|webp)$/i.test(file.originalname)) {
      cb(null, true);
    } else {
      cb(new Error('画像ファイル (.png/.jpg/.webp) のみアップロード可能です'));
    }
  },
});

// ──────────────────────────────────────
// API: AI APIキー設定状態
// ──────────────────────────────────────
app.get('/api/apistatus', (req, res) => {
  const key = runtimeApiKey || process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY || '';
  const configured = key.length > 0 && key !== 'your_gemini_api_key_here';
  res.json({ configured, engine: runtimeEngine });
});

// ──────────────────────────────────────
// API: セッションログ取得（フロントエンドポーリング用）
// ──────────────────────────────────────
app.get('/api/logs/:sessionId', (req, res) => {
  const { sessionId } = req.params;
  const sinceIndex = parseInt(req.query.sinceIndex || '0', 10);
  const logs = sessionLogs.get(sessionId) || [];
  const newLogs = logs.slice(sinceIndex);
  res.json({ logs: newLogs, nextIndex: logs.length });
});

// ──────────────────────────────────────
// API: AI APIキーを設定 (Gemini / OpenAI 自動認識)
// ──────────────────────────────────────
app.post('/api/apikey', async (req, res) => {
  const { apiKey } = req.body;
  if (!apiKey || !apiKey.trim()) {
    return res.status(400).json({ valid: false, error: 'APIキーが空です' });
  }

  const key = apiKey.trim();
  let engine = 'gemini';
  if (key.startsWith('sk-')) {
    engine = 'openai';
  }

  try {
    if (engine === 'openai') {
      const OpenAI = (await import('openai')).default;
      const openai = new OpenAI({ apiKey: key });
      
      const modelsToTry = ['gpt-4o', 'gpt-4o-mini'];
      let workingModel = null;
      let lastError = null;

      for (const modelName of modelsToTry) {
        try {
          await openai.chat.completions.create({
            model: modelName,
            messages: [{ role: "user", content: "test" }],
            max_tokens: 5
          }, {
            timeout: 25000
          });
          workingModel = modelName;
          break;
        } catch (e) {
          lastError = e;
          const errorMsg = e && e.message ? e.message.split('\n')[0] : String(e);
          console.log(`    ℹ️ OpenAI ${modelName} は利用不可: ${errorMsg}`);
        }
      }

      if (!workingModel) {
        throw lastError || new Error("利用可能なOpenAIモデルが見つかりませんでした");
      }

      runtimeApiKey = key;
      runtimeModel = workingModel;
      runtimeEngine = 'openai';
      console.log(`🔑 OpenAI API Key が設定されました (使用モデル: ${runtimeModel})`);
      res.json({ valid: true, engine: 'openai' });
    } else {
      const { GoogleGenerativeAI } = await import('@google/generative-ai');
      const genAI = new GoogleGenerativeAI(key);
      
      const modelsToTry = [
        'gemini-3.5-flash',
        'gemini-flash-latest',
        'gemini-2.5-flash',
        'gemini-2.5-pro',
        'gemini-1.5-pro',
        'gemini-pro-latest'
      ];
      
      let workingModel = null;
      let lastError = null;

      for (const modelName of modelsToTry) {
        try {
          const model = genAI.getGenerativeModel({ model: modelName });
          
          const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Gemini API call timed out after 25 seconds')), 25000)
          );
          const apiCallPromise = model.generateContent('test');
          await Promise.race([apiCallPromise, timeoutPromise]);
          
          workingModel = modelName;
          break; // 成功したらループを抜ける
        } catch (e) {
          lastError = e;
          const errorMsg = e && e.message ? e.message.split('\n')[0] : String(e);
          console.log(`    ℹ️ ${modelName} は利用不可: ${errorMsg}`);
        }
      }

      if (!workingModel) {
        throw lastError || new Error("利用可能なモデルが見つかりませんでした");
      }
      
      runtimeApiKey = key;
      runtimeModel = workingModel;
      runtimeEngine = 'gemini';
      console.log(`🔑 Gemini API Key が設定されました (使用モデル: ${runtimeModel})`);
      res.json({ valid: true, engine: 'gemini' });
    }
  } catch (err) {
    console.error(`❌ ${engine === 'openai' ? 'OpenAI' : 'Gemini'} API Key 検証失敗:`, err.message);
    res.json({ valid: false, error: 'APIキーが無効、または利用可能なモデルがありません' });
  }
});

// ──────────────────────────────────────
// API: VOICEVOX 接続確認
// ──────────────────────────────────────
app.get('/api/voicevox/status', async (req, res) => {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);

    const response = await fetch('http://127.0.0.1:50021/version', {
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (response.ok) {
      const version = await response.text();
      res.json({ connected: true, version: version.replace(/"/g, '') });
    } else {
      res.json({ connected: false });
    }
  } catch {
    res.json({ connected: false });
  }
});

// ──────────────────────────────────────
// API: VOICEVOXキャラクター一覧
// ──────────────────────────────────────
app.get('/api/voicevox/speakers', async (req, res) => {
  try {
    const response = await fetch('http://127.0.0.1:50021/speakers');
    if (response.ok) {
      const speakers = await response.json();
      res.json(speakers);
    } else {
      res.status(502).json({ error: 'VOICEVOX応答エラー' });
    }
  } catch {
    res.status(503).json({ error: 'VOICEVOX接続不可' });
  }
});

// ──────────────────────────────────────
// API: 生成中断＆ゴミファイル削除
// ──────────────────────────────────────
app.delete('/api/cancel/:sessionId', (req, res) => {
  const { sessionId } = req.params;
  const session = sessions.get(sessionId);
  if (session) {
    session.cancelled = true;
    sessionLog(sessionId, `🛑 [Cancel] ユーザーにより生成が中断されました。関連ファイルを削除します。`);
    
    try {
      // テンポラリディレクトリ（アップロード画像など）の削除
      const tempDir = path.join(__dirname, 'temp', sessionId);
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
      
      // 音声ディレクトリの削除
      const voiceDir = path.join(__dirname, 'public', 'voiceover', sessionId);
      if (fs.existsSync(voiceDir)) {
        fs.rmSync(voiceDir, { recursive: true, force: true });
      }
      
      // 中断時も5分後にインメモリデータを安全にクリーンアップ
      scheduleLogCleanup(sessionId);
    } catch (e) {
      console.error('Cancel cleanup error:', e);
    } finally {
      // 中断されたら即座にロックファイルを解放
      releaseLock();
    }
  }
  res.json({ success: true });
});

// ──────────────────────────────────────
// API: 画像のみアップロード（JSONは不要！）
// ──────────────────────────────────────
app.post('/api/upload', upload.single('image'), (req, res) => {
  try {
    const sessionId = req.sessionId || `session_${Date.now()}`;
    const imageFile = req.file;

    if (!imageFile) {
      return res.status(400).json({ error: '画像ファイルが必要です' });
    }

    sessions.set(sessionId, {
      imagePath: imageFile.path,
      status: 'uploaded',
      createdAt: Date.now(),
    });

    sessionLog(sessionId, `📂 [Upload] セッション作成完了`);
    sessionLog(sessionId, `📷 画像: ${imageFile.originalname}`);

    res.json({ sessionId });
  } catch (err) {
    console.error('❌ Upload error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ──────────────────────────────────────
// API: Gemini Vision OCR で漫画を解析
// ──────────────────────────────────────
app.post('/api/analyze/:sessionId', async (req, res) => {
  const { sessionId } = req.params;
  const session = sessions.get(sessionId);

  if (!session) {
    return res.status(404).json({ error: 'セッションが見つかりません' });
  }

  if (!acquireLock()) {
    return res.status(409).json({ error: '現在、別の動画生成パイプラインが実行中です。しばらくお待ちください。' });
  }

  try {
    sessionLog(sessionId, `🔍 [Analyze] AI Vision OCR 開始 (${runtimeEngine} / ${runtimeModel})...`);
    sessionLog(sessionId, `🧠 統合解析エンジン起動: 画像構造 / セリフ抽出 / 感情推定 の並列タスクを構築中...`);
    session.status = 'analyzing';

    const apiKey = runtimeApiKey || process.env.GEMINI_API_KEY;
    let metadata;

    if (!apiKey || apiKey === 'your_gemini_api_key_here') {
      console.log('    ⚠️ Gemini API Key が設定されていません。モックデータ(input/sample/metadata.json)を使用します。');
      const mockPath = path.join(__dirname, 'input', 'sample', 'metadata.json');
      if (fs.existsSync(mockPath)) {
        metadata = JSON.parse(fs.readFileSync(mockPath, 'utf8'));
      } else {
        return res.status(400).json({ error: 'Gemini API Keyが設定されておらず、モックデータも見つかりません' });
      }
    } else {
      // Gemini OCR モジュールを動的インポート
      const { GoogleGenerativeAI } = await import('@google/generative-ai');
      const genAI = new GoogleGenerativeAI(apiKey);
      
      // 動的に判定したモデルを使用（画像入力非対応のgemini-proなどが選ばれた場合のフォールバックも考慮）
      let modelToUse = runtimeModel;

      // 画像をBase64に変換
      const imageBuffer = fs.readFileSync(session.imagePath);
      const base64Image = imageBuffer.toString('base64');
      const ext = path.extname(session.imagePath).toLowerCase();
      const mimeMap = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
      const mimeType = mimeMap[ext] || 'image/png';

      const prompt = `あなたは非常に優秀な漫画解析AIです。画像を詳細に分析し、**すべてのフキダシやテキストを1つ残らず**抽出してください。一切の読み飛ばしは許されません。
【前提条件】
・この画像は「縦並びの4コマ漫画（A4縦サイズ）」です。一番上にはタイトル、一番下にはフッターがあります。
・日本の漫画は【右から左】【上から下】に進みます。
・ルビ（ふりがな）が振られている漢字は、誤読を防ぐため親文字（漢字）を優先し、自然な日本語として抽出してください。
・画像生成AIによって描かれているため、コマごとに同じキャラクターでも服や髪型に若干のブレ（非一貫性）がある場合があります。髪色やメガネなどの「特徴」から同一人物を特定してください。

## タスク
1. この漫画画像に含まれるコマ（パネル）を上から順に識別する（必ず4つのコマオブジェクトを出力すること）
2. 各コマ内の**すべてのテキスト（人間のフキダシ内のセリフだけでなく、紙、張り紙、手持ちのフリップ、旗、腕章、テレビやモニター画面、額縁、看板、服などに書かれた文字やナレーションなど、画像内の意味を持つ全てのテキスト）**を一切の漏れなく読み取る。セリフは吹き出し内のテキストをそのまま正確に転写すること。画像生成AI特有の文字の歪みや滲みによる誤読（例：『活躍』が『洋題』に見えるなど）を完全に防ぐため、会話の文脈や日本語としての自然さから不自然な単語（日本語として意味が通らない言葉）を検出し、画像から推測される本来の正しい日本語（例：『活躍』など）に自己修正（文脈補正）してください。ただし、語順の変更や要約、勝手な意訳は厳禁です。
3. 各セリフの話者を判定する（人間の場合はキャラクターの外見・位置から推定。紙や看板、旗、テレビなどの物体に書かれた文字の場合は「張り紙」「看板」「旗」「テレビ」等の物体名を話者名にすること）
4. 各セリフの感情を推定する
5. 【重要】セリフ（フキダシ）がコマ内の物理的にどの位置（左・中央・右）にあるかを空間的に厳密に判定する
   - 吹き出しの物理的な中心がコマの右半分にある → "right"
   - 吹き出しの物理的な中心がコマの中央付近にある → "center"
   - 吹き出しの物理的な中心がコマの左半分にある → "left"
   ※キャラクターの立ち位置やセリフの優先順位（読む順序）に惑わされず、吹き出し自体の物理的な配置だけを客観的に判定してください。
6. 1つのコマに複数のセリフがある場合、出力するJSONの配列内の順序は任意（順不同）です。バックエンドで自動的に物理的な位置（bubblePosition）に基づいて「右 ➔ 中央 ➔ 左」の順にソートされるため、順序を意識するあまり bubblePosition の左右判定を誤魔化したり捻じ曲げたりしないようにしてください。
7. 漫画全体のタイトルを決定する:
   - 画像内にタイトルテキストが存在する場合 → そのテキストを抽出し、さらに前後の文脈や全体のテーマからOCRの誤読がないか自己検証（文脈補完）した上でタイトルとして設定する。
   - 画像内にタイトルがない場合 → 漫画の内容・オチ・テーマから、SNS投稿に適した魅力的で簡潔な日本語タイトルを創作する（例: 「お弁当の秘密」「猫と掃除機」等）

## 出力形式
以下のJSON形式のみを出力してください。マークダウンのコードブロックは使わないでください。

{
  "title": "漫画のタイトル",
  "panels": [
    {
      "panelNumber": 1,
      "dialogues": [
        {
          "speaker": "キャラ名（推定）",
          "gender": "male または female または unknown",
          "age": "child または young または adult または elder",
          "personality": "cool または cute または energetic または calm または serious",
          "bubblePosition": "left または center または right",
          "text": "セリフの内容",
          "emotion": "感情"
        }
      ]
    }
  ]
}

## ルール
- **titleフィールドは必須**: 空文字列にしないこと。必ず意味のある日本語タイトルを設定すること
- 【最重要】抽出するテキストは**一字一句そのまま正確に転写**すること。
  - ただし、画像生成AIによる文字の滲み・歪みで発生する誤字（例: 『活躍』が『洋題』に見えるなど）は、前後の文脈や会話の流れ、一般的な日本語表現と照らし合わせ、意味が通る正しい漢字に自己検証・補正してください。
  - 日本語として意味が通らない不自然な造語のまま出力することを防ぎ、文脈に適合した単語に修正してください。
  - ただし、語順の入れ替え、言い換え、要約、意訳は一切禁止します。
- 【超重要】'dialogues' 配列には、人間のフキダシ内のセリフだけでなく、紙・張り紙・手持ちのフリップ・旗・腕章・テレビ・モニター・額縁・看板・ポスター・背景などに書かれた文字も、それぞれ独立した1つの要素として「絶対に」含めてください。人間の発話ではないという理由で除外することは固く禁じます。
- **pronunciationフィールドは必須**: 字幕用の text をベースにしつつ、英語・アルファベット部分のみを自然な日本語のカタカナ（またはひらがな）読みに変換して設定すること。英単語を含まない場合は text と全く同じ値にすること
- **bubblePositionは物理的な配置のみに基づいて客観的に判定すること**:
  - キャラクターの配置や会話の流れ、読む順番の想定に一切惑わされず、テキスト（吹き出しや文字自体の中心）が画像的に「右・中央・左」のどこにあるかだけで客観的に判定してください。
  - プログラム側がこの bubblePosition の結果に従って自動的にソートし、カメラのパン位置も決定します。この判定を誤ると、テキストの順序とカメラフォーカスが左右逆（テレコ）になってしまいます。
  - コマ内に2つ以上のテキストがある場合、それぞれの物理的中心の左右関係を比較し、より右側にある方を "right"（または中央寄りなら "center"）、より左側にある方を "left" と正確に区別して設定してください。
- 話者名はキャラクターの外見的特徴から分かりやすい名前を付けること（例: 「青髪の少女」「メガネの男性」等）。ただし、紙や看板、旗、腕章、テレビなどの物体に書かれた文字の場合は、その物体名（例: 「張り紙」「看板」「旗」「腕章」「テレビ」）を話者名とすること。
- 同じキャラクターや物体には一貫した名前を使うこと
- ナレーション（吹き出し外のテキスト）は speaker を "ナレーション" にすること
- コマは上から下、左から右の順に番号を振ること
- 効果音やオノマトペ（例: ドクン、ババーン等）はスキップしてください。ただし、意味のある単語や文章（例: 風紀、完売です、等）は絶対にスキップしないでください。
- 感情は neutral/happy/sad/angry/surprised/excited/worried 等から選択
- personalityはキャラクターの見た目や雰囲気から推定すること（cool=クール・無表情・知的, cute=可愛い・幼い, energetic=元気・活発, calm=穏やか・おっとり, serious=真面目・厳格）`;

      let responseText = "";
      let success = false;
      let lastError = null;

      if (runtimeEngine === 'openai') {
        const OpenAI = (await import('openai')).default;
        const openai = new OpenAI({ apiKey: apiKey });
        const dataUrl = `data:${mimeType};base64,${base64Image}`;
        
        const openAiFallbackList = ['gpt-4o', 'gpt-4o-mini'];
        const startIdx = openAiFallbackList.indexOf(runtimeModel);
        const modelsToAttempt = startIdx !== -1 
          ? [runtimeModel, ...openAiFallbackList.filter(m => m !== runtimeModel)]
          : [runtimeModel, ...openAiFallbackList];

        for (const modelName of modelsToAttempt) {
          try {
            sessionLog(sessionId, `⏳ OpenAI API リクエスト送信中 (モデル: ${modelName})...`);
            const response = await openai.chat.completions.create({
              model: modelName,
              messages: [
                { role: "system", content: "あなたは優秀な漫画解析AIです。必ず指定されたJSONフォーマットで出力してください。" },
                { role: "user", content: [
                    { type: "text", text: prompt },
                    { type: "image_url", image_url: { url: dataUrl, detail: "high" } }
                  ]
                }
              ],
              response_format: { type: "json_object" },
              temperature: 0.1
            }, {
              timeout: 25000
            });
            
            responseText = response.choices[0].message.content;
            sessionLog(sessionId, `📝 OpenAI レスポンス受信 (${responseText.length}文字)`);
            runtimeModel = modelName;
            success = true;
            break;
          } catch (err) {
            lastError = err;
            sessionLog(sessionId, `⚠️ [Fallback] OpenAIモデル ${modelName} でエラー発生: ${err.message}`);
          }
        }
      } else {
        // Gemini ロジック
        const { GoogleGenerativeAI } = await import('@google/generative-ai');
        const genAI = new GoogleGenerativeAI(apiKey);

        const geminiFallbackList = [
          'gemini-3.5-flash',
          'gemini-flash-latest',
          'gemini-2.5-flash',
          'gemini-2.5-pro',
          'gemini-1.5-pro',
          'gemini-pro-latest'
        ];
        const startIdx = geminiFallbackList.indexOf(runtimeModel);
        const modelsToAttempt = startIdx !== -1 
          ? [runtimeModel, ...geminiFallbackList.filter(m => m !== runtimeModel)]
          : [runtimeModel, ...geminiFallbackList];

        for (const modelName of modelsToAttempt) {
          try {
            sessionLog(sessionId, `⏳ Gemini API リクエスト送信中 (モデル: ${modelName})...`);
            const model = genAI.getGenerativeModel({
              model: modelName,
              generationConfig: {
                temperature: 0.1,
                responseMimeType: "application/json"
              },
            });

            const timeoutPromise = new Promise((_, reject) =>
              setTimeout(() => reject(new Error('Gemini API call timed out after 25 seconds')), 25000)
            );
            const apiCallPromise = model.generateContent([
              prompt,
              { inlineData: { mimeType, data: base64Image } },
            ]);
            const result = await Promise.race([apiCallPromise, timeoutPromise]);

            responseText = result.response.text();
            sessionLog(sessionId, `📝 Gemini レスポンス受信 (${responseText.length}文字)`);
            runtimeModel = modelName;
            success = true;
            break;
          } catch (err) {
            lastError = err;
            sessionLog(sessionId, `⚠️ [Fallback] Geminiモデル ${modelName} でエラー発生: ${err.message}`);
          }
        }
      }

      if (!success) {
        throw lastError || new Error("すべてのAIモデルの試行に失敗しました");
      }

      if (session.cancelled) throw new Error('CanceledByUser');

      sessionLog(sessionId, `🔬 [Parser] JSONペイロードを抽出中... コードフェンス検出 & サニタイズ処理`);

      // JSONパース（Geminiの不正JSON出力に対応するサニタイズ処理付き）
      function sanitizeJson(raw) {
        let s = raw.trim();
        // コードフェンスを除去
        if (s.startsWith('```')) {
          s = s.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
        }
        // トレイリングカンマを除去 (配列・オブジェクト末尾の ,] や ,} )
        s = s.replace(/,\s*([}\]])/g, '$1');
        // 制御文字を除去（改行・タブ以外）
        s = s.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');
        return s;
      }

      let cleaned = sanitizeJson(responseText);
      try {
        metadata = JSON.parse(cleaned);
      } catch (parseErr1) {
        sessionLog(sessionId, `⚠️ [Parser] 1次パース失敗: ${parseErr1.message}`);
        console.error(`[Parser Error] 1次パース失敗。生レスポンス:\n${responseText}\n---`);
        // フォールバック: JSON部分だけを抽出して再トライ
        const jsonMatch = responseText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          try {
            metadata = JSON.parse(sanitizeJson(jsonMatch[0]));
          } catch (parseErr2) {
            sessionLog(sessionId, `❌ [Parser] 2次パースも失敗: ${parseErr2.message}`);
            console.error(`[Parser Error] 2次パースも失敗。抽出試行JSON:\n${jsonMatch[0]}\n---`);
            throw new Error('AIの応答からメタデータを抽出できませんでした。再度お試しください。');
          }
        } else {
          console.error(`[Parser Error] JSONパターンマッチ失敗。レスポンス内に { } が見つかりません。`);
          throw new Error('AIの応答からメタデータを抽出できませんでした。再度お試しください。');
        }
      }
    }

    // ── AIによる2-Pass テキスト自動校正 (Contextual Dialogue Correction Pass) ──
    if (metadata && metadata.panels && metadata.panels.length > 0 && apiKey) {
      try {
        sessionLog(sessionId, `📝 [OCR Correction] 2-Pass目: AIによる日本語コンテキスト校正を開始中...`);

        // 校正用のプロンプト構築
        const correctionInput = {
          title: metadata.title || '無題',
          panels: metadata.panels.map(p => ({
            panelNumber: p.panelNumber,
            dialogues: (p.dialogues || []).map(d => ({
              speaker: d.speaker || '不明',
              text: d.text || '',
              pronunciation: d.pronunciation || ''
            }))
          }))
        };

        const correctionPrompt = `あなたは非常に優秀なマンガ編集者および校正・校閲AIです。
入力された漫画の全テキスト（Vision OCRの文字起こし結果）を読み、日本語として自然で前後のストーリーの文脈に合うように、誤字脱字や文字の誤認識（文字の滲みや歪みによる誤読）を校正してください。

【コンテキスト】
・画像生成AIによって描かれているため、吹き出しやタイトル内の漢字（例:「活躍」が「洋題」や「躍」と誤認識される、似た形状の「樽」が「桶」と誤読されるケース等）やひらがな・助詞が誤読されている可能性が極めて高いです。
・前後の会話の流れ、キャラクターの口調、および全体を通して登場するキーワードの整合性から、明らかに日本語として不自然な単語や文脈と合わない言葉を検出し、本来の正しい表現に自己修正してください。

【校正ルール】
1. セリフの口調（ギャル風、丁寧語、幼い表現など）やキャラクターの個性は絶対に維持してください。
2. 意味が大きく変わるような改変、要約、勝手なセリフの追加・削除は絶対にしないでください。
3. 誤読（例:「洋題」➔「活躍」、「桶」➔「樽」等）や、てにをはの崩れのみを修正し、正しい日本語の部分は一切変更しないでください。
4. text（字幕用）を修正した場合は、pronunciation（発音用）もそれに合わせて正しい読みに修正してください。titleを修正した場合も同様です。
5. 出力は入力と全く同じJSON構造（titleキーとpanelsキーを含むオブジェクト）のみを返してください。マークダウンのコードブロックは使わないでください。

【校正対象のJSON】
${JSON.stringify(correctionInput, null, 2)}`;

        let correctedText = "";
        let correctionSuccess = false;

        if (runtimeEngine === 'openai') {
          const OpenAI = (await import('openai')).default;
          const openai = new OpenAI({ apiKey: apiKey });
          
          const correctionModels = ['gpt-4o-mini', 'gpt-4o'];
          const modelName = correctionModels.includes(runtimeModel) ? runtimeModel : 'gpt-4o-mini';

          const response = await openai.chat.completions.create({
            model: modelName,
            messages: [
              { role: "system", content: "あなたは優秀な校正・校閲AIです。必ず指定されたJSONフォーマットのみを出力してください。" },
              { role: "user", content: correctionPrompt }
            ],
            response_format: { type: "json_object" },
            temperature: 0.1
          }, {
            timeout: 25000
          });
          correctedText = response.choices[0].message.content;
          correctionSuccess = true;
        } else {
          // Gemini
          const { GoogleGenerativeAI } = await import('@google/generative-ai');
          const genAI = new GoogleGenerativeAI(apiKey);
          const modelName = runtimeModel.includes('gemini') ? runtimeModel : 'gemini-2.5-flash';

          const model = genAI.getGenerativeModel({
            model: modelName,
            generationConfig: {
              temperature: 0.1,
              responseMimeType: "application/json"
            },
          });

          const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Gemini API call timed out after 25 seconds')), 25000)
          );
          const apiCallPromise = model.generateContent([correctionPrompt]);
          const result = await Promise.race([apiCallPromise, timeoutPromise]);
          correctedText = result.response.text();
          correctionSuccess = true;
        }

        if (correctionSuccess && correctedText) {
          function sanitizeJson(raw) {
            let s = raw.trim();
            if (s.startsWith('```')) {
              s = s.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
            }
            s = s.replace(/,\s*([}\]])/g, '$1');
            s = s.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');
            return s;
          }

          let cleanedCorrection = sanitizeJson(correctedText);
          const correctedData = JSON.parse(cleanedCorrection);

          if (correctedData.title && correctedData.title !== metadata.title) {
            sessionLog(sessionId, `🔧 [OCR Corrected Title] "${metadata.title}" ➔ "${correctedData.title}"`);
            metadata.title = correctedData.title;
          }

          const correctedPanels = Array.isArray(correctedData.panels) 
            ? correctedData.panels 
            : (Array.isArray(correctedData) ? correctedData : (correctedData.data || []));

          if (correctedPanels && correctedPanels.length > 0) {
            metadata.panels.forEach(p => {
              const cp = correctedPanels.find(x => x.panelNumber === p.panelNumber);
              if (cp && cp.dialogues) {
                p.dialogues.forEach((d, idx) => {
                  const cpDialogues = cp.dialogues;
                  const cd = cpDialogues[idx];
                  if (cd && cd.text) {
                    if (d.text !== cd.text) {
                      sessionLog(sessionId, `🔧 [OCR Corrected] "${d.text}" ➔ "${cd.text}"`);
                      d.text = cd.text;
                    }
                    if (cd.pronunciation) {
                      d.pronunciation = cd.pronunciation;
                    }
                  }
                });
              }
            });
            sessionLog(sessionId, `✅ [OCR Correction] 2-Pass校正完了！誤読が自動修復されました。`);
          }
        }
      } catch (err) {
        sessionLog(sessionId, `⚠️ [OCR Correction] 2-Pass校正処理中にエラー（スキップします）: ${err.message}`);
        console.error('OCR Correction Error:', err);
      }
    }

    // 構造を正規化しつつ、キャラごとの声の重複を防ぐ（性格ベースキャスティング v2）
    const characterVoiceMap = new Map();
    const usedVoiceIds = new Set();

    // 性格×性別ベースのボイスプール定義
    // 女性: cool→落ち着いた声, cute→可愛い声, energetic→元気な声, calm→穏やかな声, serious→知的な声
    // 男性: cool/serious→渋い声, energetic→若い声, calm→穏やかな声
    const VOICE_POOLS = {
      female: {
        cool:      [10, 16, 14],    // 雨晴はう, 九州そら, 冥鳴ひまり
        cute:      [8, 2, 9],       // 春日部つむぎ, 四国めたん, 波音リツ
        energetic: [8, 9, 2],       // 春日部つむぎ, 波音リツ, 四国めたん
        calm:      [14, 16, 10],    // 冥鳴ひまり, 九州そら, 雨晴はう
        serious:   [10, 14, 16],    // 雨晴はう, 冥鳴ひまり, 九州そら
      },
      male: {
        cool:      [11, 13],        // 玄野武宏, 青山龍星
        cute:      [12, 13],        // 白上虎太郎, 青山龍星
        energetic: [12, 13],        // 白上虎太郎, 青山龍星
        calm:      [11, 13],        // 玄野武宏, 青山龍星
        serious:   [11, 13],        // 玄野武宏, 青山龍星
      },
      // デフォルト（gender不明時）
      unknown: {
        cool:      [10, 16, 11],
        cute:      [8, 2, 12],
        energetic: [8, 9, 12],
        calm:      [14, 16, 11],
        serious:   [10, 14, 11],
      },
    };

    // ナレーション判定用パターン
    const narratorPatterns = ['ナレ', 'narr', '語り手', '地の文', 'ナレーター', 'ナレータ'];

    metadata = {
      title: metadata.title || '無題の漫画',
      panels: (metadata.panels || []).map((p, i) => ({
        panelNumber: p.panelNumber || i + 1,
        dialogues: (p.dialogues || []).map(d => {
          const gender = d.gender || 'unknown';
          const age = d.age || 'young';
          const personality = d.personality || 'calm';
          const speaker = d.speaker || '不明';

          // ナレーション判定
          const isNarrator = narratorPatterns.some(pat => speaker.toLowerCase().includes(pat.toLowerCase()));

          let voiceId;
          if (characterVoiceMap.has(speaker)) {
            voiceId = characterVoiceMap.get(speaker);
          } else {
            if (isNarrator) {
              voiceId = 2; // 四国めたんノーマル（ナレーション専用）
            } else {
              // 性格×性別からプールを選択
              const genderKey = VOICE_POOLS[gender] ? gender : 'unknown';
              const pool = VOICE_POOLS[genderKey][personality] || VOICE_POOLS[genderKey].calm;

              // 子供キャラは特別扱い: 男児→白上虎太郎, 女児→春日部つむぎ
              let finalPool = pool;
              if (age === 'child') {
                finalPool = gender === 'male' ? [12] : [8];
              }

              // 未使用の声を優先して重複を回避
              const unusedPool = finalPool.filter(id => !usedVoiceIds.has(id));
              const selectFrom = unusedPool.length > 0 ? unusedPool : finalPool;
              const hash = [...speaker].reduce((h, c) => h + c.charCodeAt(0), 0);
              voiceId = selectFrom[hash % selectFrom.length];
            }

            characterVoiceMap.set(speaker, voiceId);
            usedVoiceIds.add(voiceId);

            sessionLog(sessionId, `🎭 [Casting v2] 検出話者: ${speaker} (${gender}, ${age}, ${personality})`);
            sessionLog(sessionId, `   ↳ 性格プロファイル "${personality}" からボイスプールを選択`);
            sessionLog(sessionId, `   ↳ 重複回避アルゴリズム適用 -> VOICEVOX ID: ${voiceId} をアサイン`);
          }

          return {
            speaker,
            gender,
            age,
            personality,
            bubblePosition: d.bubblePosition || 'center',
            text: d.text || '',
            emotion: d.emotion || 'neutral',
            voiceId
          };
        }),
      })),
    };
    // ── 日本の漫画読み順を強制適用: 各コマ内のセリフを右→中→左にソート ──
    const positionOrder = { right: 0, center: 1, left: 2 };
    for (const panel of metadata.panels) {
      const before = panel.dialogues.map(d => `${d.speaker}(${d.bubblePosition})`).join(' → ');
      panel.dialogues.sort((a, b) => {
        const orderA = positionOrder[a.bubblePosition] ?? 1;
        const orderB = positionOrder[b.bubblePosition] ?? 1;
        return orderA - orderB;
      });
      const after = panel.dialogues.map(d => `${d.speaker}(${d.bubblePosition})`).join(' → ');
      if (before !== after) {
        sessionLog(sessionId, `📖 [Reading Order] コマ${panel.panelNumber}: セリフ順を右→左に修正`);
        sessionLog(sessionId, `   ↳ ${after}`);
      }
    }

    // ── コマ跨ぎ重複セリフの自動除去 (Dedup Engine) ──
    // Geminiが同じセリフを複数コマに重複出力するケースへの対策
    // 同一 speaker + text の組み合わせが異なるコマに現れた場合、
    // 後のコマ（より正確な検出）を残し、前のコマの重複を除去する
    {
      // 全セリフをフラットに収集（コマ番号付き）
      const allDialogues = [];
      for (const panel of metadata.panels) {
        for (const d of panel.dialogues) {
          allDialogues.push({ key: `${d.speaker}|||${d.text}`, panelNumber: panel.panelNumber });
        }
      }

      // 重複キーを検出（最後に出現したコマ番号を記録）
      const lastOccurrence = new Map();
      for (const entry of allDialogues) {
        lastOccurrence.set(entry.key, entry.panelNumber);
      }

      // 前方コマの重複を除去
      let dedupCount = 0;
      for (const panel of metadata.panels) {
        const originalLen = panel.dialogues.length;
        panel.dialogues = panel.dialogues.filter(d => {
          const key = `${d.speaker}|||${d.text}`;
          const lastPanel = lastOccurrence.get(key);
          // 最後に出現したコマでなければ重複 → 除去
          if (lastPanel !== panel.panelNumber) {
            return false;
          }
          return true;
        });
        const removed = originalLen - panel.dialogues.length;
        if (removed > 0) {
          dedupCount += removed;
          sessionLog(sessionId, `🔄 [Dedup] コマ${panel.panelNumber}: 重複セリフ ${removed}件を除去（後方コマに正本あり）`);
        }
      }
      if (dedupCount > 0) {
        sessionLog(sessionId, `✅ [Dedup] 合計 ${dedupCount}件の重複セリフを自動除去`);
      }
    }

    // セッションにメタデータを保存
    session.metadata = metadata;
    session.status = 'analyzed';

    let bgmAudioPath = `audio/bgm.wav`; // デフォルトフォールバック
    // 感情に基づくBGMの動的生成（プロシージャル作曲エンジン）
    try {
      const { execSync } = await import('child_process');
      const emotionCounts = { happy: 0, excited: 0, sad: 0, worried: 0, angry: 0, neutral: 0, surprised: 0 };
      for (const panel of metadata.panels) {
        for (const d of panel.dialogues) {
          if (emotionCounts[d.emotion] !== undefined) emotionCounts[d.emotion]++;
          else emotionCounts.neutral++;
        }
      }
      const dominantEmotion = Object.keys(emotionCounts).reduce((a, b) => emotionCounts[a] > emotionCounts[b] ? a : b);
      const bgmSeed = Date.now();
      sessionLog(sessionId, `🎵 [BGM Engine] Dominant Emotion: ${dominantEmotion} (Seed: ${bgmSeed})`);
      
      const bgmFilename = `${sessionId}_bgm.wav`;
      const stdout = execSync(`node generate_bgm.js ${dominantEmotion} ${bgmSeed} ${bgmFilename}`, { cwd: process.cwd() });
      const bgmLogs = stdout.toString().split('\n').filter(line => line.trim());
      bgmLogs.forEach(log => sessionLog(sessionId, log));

      // 生成が成功したか確認
      if (fs.existsSync(path.join(__dirname, 'public', 'audio', bgmFilename))) {
        bgmAudioPath = `audio/${bgmFilename}`;
      }
    } catch (e) {
      console.error('BGMの生成に失敗しました:', e);
      sessionLog(sessionId, `⚠️ [BGM Engine] BGM生成に失敗したため、デフォルトBGMを使用します: ${e.message}`);
    }

    session.bgmAudio = bgmAudioPath; // セッションにBGMパスを退避

    const totalDialogues = metadata.panels.reduce((s, p) => s + p.dialogues.length, 0);
    const speakers = [...new Set(metadata.panels.flatMap(p => p.dialogues.map(d => d.speaker)))];

    sessionLog(sessionId, `✅ OCR完了: "${metadata.title}"`);
    sessionLog(sessionId, `コマ数: ${metadata.panels.length}, セリフ数: ${totalDialogues}`);
    sessionLog(sessionId, `話者: ${speakers.join(', ')}`);

    res.json({ metadata });

  } catch (err) {
    console.error('❌ Analyze error:', err);
    session.status = 'error';
    res.status(500).json({ error: err.message });
  } finally {
    releaseLock();
  }
});

// ──────────────────────────────────────
// API: 音声合成＆動画生成
// ──────────────────────────────────────
app.post('/api/generate/:sessionId', async (req, res) => {
  const { sessionId } = req.params;
  const session = sessions.get(sessionId);

  if (!session) {
    return res.status(404).json({ error: 'セッションが見つかりません' });
  }

  if (!session.metadata) {
    return res.status(400).json({ error: 'まずAI解析を実行してください' });
  }

  if (!acquireLock()) {
    return res.status(409).json({ error: '現在、別の動画生成パイプラインが実行中です。しばらくお待ちください。' });
  }

  try {
    sessionLog(sessionId, `🎬 [Generate] 動画生成を開始...`);
    session.status = 'generating';

    const metadata = session.metadata;
    const title = metadata.title;
    const bgmAudioPath = session.bgmAudio || `audio/bgm.wav`; // セッションからBGMパスを復元
    const dialogues = [];

    for (const panel of metadata.panels) {
      for (const d of panel.dialogues || []) {
        dialogues.push({
          speaker: d.speaker,
          gender: d.gender,
          age: d.age,
          voiceId: d.voiceId,
          bubblePosition: d.bubblePosition || 'center',
          text: d.text,
          emotion: d.emotion,
          panelIndex: (panel.panelNumber || 1) - 1,
        });
      }
    }

    sessionLog(sessionId, `📖 タイトル: ${title}`);
    sessionLog(sessionId, `💬 セリフ数: ${dialogues.length}`);

    if (session.cancelled) throw new Error('CanceledByUser');

    // ── 画像分割 (sharp) ──
    sessionLog(sessionId, '✂️ [Sharp] 画像をコマごとに分割中...');
    const publicPanelsDir = path.join(__dirname, 'public', 'panels');
    if (!fs.existsSync(publicPanelsDir)) fs.mkdirSync(publicPanelsDir, { recursive: true });

    const metadataImg = await sharp(session.imagePath).metadata();
    const width = metadataImg.width;
    const height = metadataImg.height;
    if (!width || !height) {
      throw new Error('画像のサイズ情報を取得できませんでした。画像ファイルが破損している可能性があります。');
    }
    sessionLog(sessionId, `📐 [Sharp] 原画解析: ${width}×${height}px (${(width * height / 1000000).toFixed(1)}MP)`);

    const panelCount = Math.max(1, metadata.panels.length);
    const panelPaths = [];
    const panelAspectRatios = [];
    const aspectRatio = width / height;
    
    let layout = 'grid';
    // A4縦 (約0.707) も縦割り (vertical) と判定させるため、閾値を0.9に緩和
    if (aspectRatio < 0.9) layout = 'vertical';
    else if (aspectRatio > 1.5) layout = 'horizontal';
    sessionLog(sessionId, `📐 [Sharp] レイアウト判定: ${layout} (aspect: ${aspectRatio.toFixed(3)}) → ${panelCount}コマ分割`);

    for (let i = 0; i < panelCount; i++) {
      let extractRegion;
      switch (layout) {
        case 'vertical': {
          // ユーザー専用フォーマット（Super FURU AI 4-koma等）の最適化
          // 上部のタイトル領域（約4.5%）と下部のフッター領域（約2.5%）を除外し、純粋なコマ部分のみを等分する
          // ※ topMarginが大きすぎると1コマ目のキャラの頭が切れるため控えめに設定
          const topMargin = Math.floor(height * 0.045);
          const bottomMargin = Math.floor(height * 0.025);
          const contentHeight = height - topMargin - bottomMargin;
          const panelHeight = Math.floor(contentHeight / panelCount);
          
          extractRegion = {
            left: 0, top: topMargin + (panelHeight * i), width: width,
            height: i < panelCount - 1 ? panelHeight : contentHeight - panelHeight * i,
          };
          break;
        }
        case 'horizontal': {
          const panelWidth = Math.floor(width / panelCount);
          extractRegion = {
            left: panelWidth * i, top: 0,
            width: i < panelCount - 1 ? panelWidth : width - panelWidth * i,
            height: height,
          };
          break;
        }
        case 'grid': {
          const cols = 2;
          const rows = Math.ceil(panelCount / cols);
          const panelWidth = Math.floor(width / cols);
          const panelHeight = Math.floor(height / rows);
          
          // 日本の漫画（右から左）の読む順（右上 -> 左上 -> 右下 -> 左下）を動的に計算
          const targetCol = 1 - (i % cols); // col=1 (右), col=0 (左)
          const targetRow = Math.floor(i / cols);

          extractRegion = {
            left: panelWidth * targetCol, top: panelHeight * targetRow,
            width: targetCol < cols - 1 ? panelWidth : width - panelWidth * targetCol,
            height: targetRow < rows - 1 ? panelHeight : height - panelHeight * targetRow,
          };
          break;
        }
      }

      const outputFileName = `${sessionId}_panel_${i + 1}.png`;
      const outputPath = path.join(publicPanelsDir, outputFileName);
      await sharp(session.imagePath).extract(extractRegion).png({ quality: 95 }).toFile(outputPath);
      panelPaths.push(`panels/${outputFileName}`);
      panelAspectRatios.push(extractRegion.width / extractRegion.height);
    }
    sessionLog(sessionId, `✅ ${panelCount}コマに分割完了 (${layout})`);

    // アウトロ用にオリジナル画像全体もコピー
    const originalImageName = `${sessionId}_full.png`;
    const originalImagePath = path.join(publicPanelsDir, originalImageName);
    fs.copyFileSync(session.imagePath, originalImagePath);
    const originalImagePublicPath = `panels/${originalImageName}`;

    // ── VOICEVOX 音声合成 ──
    sessionLog(sessionId, '🎙️ [VOICEVOX] 音声合成パイプラインを起動...');
    sessionLog(sessionId, `   ↳ 合成対象: ${dialogues.length}セリフ + タイトルコール`);
    const publicVoiceDir = path.join(__dirname, 'public', 'voiceover', sessionId);
    if (!fs.existsSync(publicVoiceDir)) fs.mkdirSync(publicVoiceDir, { recursive: true });

    const audioFiles = [];
    for (let i = 0; i < dialogues.length; i++) {
      if (session.cancelled) throw new Error('CanceledByUser');
      const d = dialogues[i];
      const speakerId = getSpeakerId(d);
      const filename = `line_${String(i + 1).padStart(2, '0')}.wav`;
      const filepath = path.join(publicVoiceDir, filename);

      const displayText = d.text.length > 25 ? d.text.substring(0, 25) + '...' : d.text;
      sessionLog(sessionId, `🎤 [Casting] ${d.speaker} (${d.gender}, ${d.age}) → Voice ID: ${speakerId}`);
      sessionLog(sessionId, `  [${i + 1}/${dialogues.length}] "${displayText}"`);

      try {
        // audio_query (読み辞書でIT用語等をカタカナ読みに変換してから送信)
        const voiceText = await applyFullPronunciationPipeline(d.text, sessionId);
        
        const queryController = new AbortController();
        const queryTimeout = setTimeout(() => queryController.abort(), 30000); // 30秒タイムアウト

        const queryRes = await fetch(
          `http://127.0.0.1:50021/audio_query?text=${encodeURIComponent(voiceText)}&speaker=${speakerId}`,
          { 
            method: 'POST',
            signal: queryController.signal
          }
        );
        clearTimeout(queryTimeout);

        if (!queryRes.ok) throw new Error(`VOICEVOX audio_query failed with status ${queryRes.status}`);
        const query = await queryRes.json();
        
        // ── 感情表現エンジン v2: pitch / intonation / volume で感情を表現 ──
        const EMOTION_PROFILES = {
          angry:     { pitchScale: -0.03, intonationScale: 1.5, volumeScale: 1.2 },
          sad:       { pitchScale: -0.05, intonationScale: 0.6, volumeScale: 0.85 },
          worried:   { pitchScale: 0.0,   intonationScale: 0.7, volumeScale: 0.9 },
          happy:     { pitchScale: 0.04,  intonationScale: 1.4, volumeScale: 1.1 },
          excited:   { pitchScale: 0.05,  intonationScale: 1.6, volumeScale: 1.15 },
          surprised: { pitchScale: 0.06,  intonationScale: 1.7, volumeScale: 1.1 },
          neutral:   { pitchScale: 0.0,   intonationScale: 1.0, volumeScale: 1.0 },
        };
        const profile = EMOTION_PROFILES[d.emotion] || EMOTION_PROFILES.neutral;

        // ── 速度正規化エンジン: モーラデータから実効速度を統一 ──
        // VOICEVOXの各モデルは固有の発話速度を持つため、speedScale固定では速度差が生じる
        // audio_queryが返すモーラの合計時間から実際の発話時間を計算し、
        // 目標速度（1文字あたり0.15秒 ≒ 約6.6文字/秒。ほんの少しだけ遅く微調整）
        const TARGET_SEC_PER_CHAR = 0.15;
        let totalMoraDuration = 0;
        for (const phrase of (query.accent_phrases || [])) {
          for (const mora of (phrase.moras || [])) {
            totalMoraDuration += (mora.vowel_length || 0) + (mora.consonant_length || 0);
          }
          if (phrase.pause_mora) {
            totalMoraDuration += phrase.pause_mora.vowel_length || 0;
          }
        }
        const textLength = d.text.replace(/[、。！？…\s]/g, '').length || 1;
        const targetDuration = textLength * TARGET_SEC_PER_CHAR;
        const normalizedSpeed = totalMoraDuration > 0
          ? Math.max(0.85, Math.min(1.6, totalMoraDuration / targetDuration))
          : 1.25; // フォールバック

        query.speedScale = normalizedSpeed;
        query.pitchScale = profile.pitchScale;
        query.intonationScale = profile.intonationScale;
        query.volumeScale = profile.volumeScale;
        sessionLog(sessionId, `   🎚️ 速度正規化: モーラ=${totalMoraDuration.toFixed(2)}s / 文字数=${textLength} → spd=${normalizedSpeed.toFixed(2)}x | pitch=${profile.pitchScale} / inton=${profile.intonationScale} / vol=${profile.volumeScale}`);

        // synthesis
        const synthController = new AbortController();
        const synthTimeout = setTimeout(() => synthController.abort(), 30000); // 30秒タイムアウト

        const synthRes = await fetch(
          `http://127.0.0.1:50021/synthesis?speaker=${speakerId}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(query),
            signal: synthController.signal
          }
        );
        clearTimeout(synthTimeout);

        if (!synthRes.ok) throw new Error(`VOICEVOX synthesis failed with status ${synthRes.status}`);
        const wavBuffer = Buffer.from(await synthRes.arrayBuffer());
        fs.writeFileSync(filepath, wavBuffer);

        // WAVからduration取得
        const durationSec = getWavDuration(wavBuffer);
        audioFiles.push({ filename, publicPath: `voiceover/${sessionId}/${filename}`, durationSec, dialogue: d });
        sessionLog(sessionId, `  ✅ ${durationSec.toFixed(2)}s → ${filename}`);
      } catch (err) {
        console.error(`      ❌ 音声生成失敗: ${err.message}`);
        audioFiles.push({ filename, publicPath: null, durationSec: 3, dialogue: d });
      }
    }

    const totalAudioSec = audioFiles.reduce((s, a) => s + a.durationSec, 0);
    sessionLog(sessionId, `✅ [VOICEVOX] セリフ音声合成完了: ${audioFiles.length}本 / 合計 ${totalAudioSec.toFixed(1)}秒`);

    // ── タイトルコール音声 ──
    sessionLog(sessionId, '📢 [Title Call] ずんだもん (ID:3) によるタイトルコール音声を合成中...');
    const titleAudioPath = path.join(publicVoiceDir, 'title_call.wav');
    let titleAudioPublicPath = null;
    try {
      const titleVoiceText = await applyFullPronunciationPipeline(title, sessionId);

      const titleQueryController = new AbortController();
      const titleQueryTimeout = setTimeout(() => titleQueryController.abort(), 30000);

      const titleQueryRes = await fetch(
        `http://127.0.0.1:50021/audio_query?text=${encodeURIComponent(titleVoiceText)}&speaker=3`,
        { 
          method: 'POST',
          signal: titleQueryController.signal
        }
      );
      clearTimeout(titleQueryTimeout);

      if (!titleQueryRes.ok) throw new Error(`VOICEVOX title call audio_query failed with status ${titleQueryRes.status}`);
      const titleQuery = await titleQueryRes.json();
      titleQuery.speedScale = 0.95;
      titleQuery.pitchScale = 0.05;

      const titleSynthController = new AbortController();
      const titleSynthTimeout = setTimeout(() => titleSynthController.abort(), 30000);

      const titleSynthRes = await fetch(
        `http://127.0.0.1:50021/synthesis?speaker=3`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(titleQuery),
          signal: titleSynthController.signal
        }
      );
      clearTimeout(titleSynthTimeout);

      if (!titleSynthRes.ok) throw new Error(`VOICEVOX title call synthesis failed with status ${titleSynthRes.status}`);
      const titleWav = Buffer.from(await titleSynthRes.arrayBuffer());
      fs.writeFileSync(titleAudioPath, titleWav);
      titleAudioPublicPath = `voiceover/${sessionId}/title_call.wav`;
      const titleDurationSec = getWavDuration(titleWav);
      var titleDurationFrames = Math.ceil(titleDurationSec * 30) + 15;
      sessionLog(sessionId, `✅ タイトルコール音声生成完了 (${titleDurationSec.toFixed(2)}s)`);
    } catch (err) {
      console.log(`    ⚠️ タイトルコール生成スキップ: ${err.message}`);
      var titleDurationFrames = 90; // フォールバック
    }

    sessionLog(sessionId, '🗂️ [Timeline] 動画タイムラインを構築中...');

    // セリフ末尾の句読点・感情に基づく動的パディング（間の長さ）
    function calcPadding(text, emotion) {
      const lastChar = text.slice(-1);
      if (lastChar === '…' || text.endsWith('...')) return 22; // 余韻が必要な沈黙
      if (lastChar === '。' || lastChar === '.') return 16;    // 通常の区切り
      if (lastChar === '！' || lastChar === '!') return 8;     // テンポよく
      if (lastChar === '？' || lastChar === '?') return 18;    // 問いかけの間
      if (emotion === 'sad' || emotion === 'worried') return 20; // 感情的な間
      if (emotion === 'angry' || emotion === 'excited') return 8; // 畳みかけ
      return 12; // デフォルト
    }

    const scriptData = {
      title,
      version: SYSTEM_VERSION,
      panels: panelPaths, // 分割されたコマ画像パス
      panelAspectRatios, // 各コマのアスペクト比（動的ズーム用）
      originalImage: originalImagePublicPath, // 全体画像
      titleAudio: titleAudioPublicPath,
      titleDurationInFrames: titleDurationFrames,
      bgmAudio: bgmAudioPath,
      dialogues: audioFiles.map((af, i) => ({
        id: `line_${String(i + 1).padStart(2, '0')}`,
        speaker: af.dialogue.speaker,
        text: af.dialogue.text,
        panelIndex: af.dialogue.panelIndex,
        bubblePosition: af.dialogue.bubblePosition,
        durationInFrames: Math.ceil(af.durationSec * 30) + calcPadding(af.dialogue.text, af.dialogue.emotion),
        audioFile: af.publicPath,
      })),
    };
    scriptData.totalDurationInFrames = scriptData.dialogues.reduce(
      (sum, d) => sum + d.durationInFrames, 0
    ) + scriptData.titleDurationInFrames + 180; // タイトルカード余白 + アウトロ余白(180)

    const totalSec = (scriptData.totalDurationInFrames / 30).toFixed(1);
    sessionLog(sessionId, `   ↳ タイトルカード: ${titleDurationFrames}F | セリフ区間: ${scriptData.dialogues.reduce((s,d)=>s+d.durationInFrames,0)}F | アウトロ: 180F`);
    sessionLog(sessionId, `   ↳ 合計: ${scriptData.totalDurationInFrames}F (${totalSec}秒 @30fps)`);

    const scriptDataPath = path.join(__dirname, 'temp', sessionId, 'scriptData.json');
    fs.writeFileSync(scriptDataPath, JSON.stringify(scriptData, null, 2), 'utf8');
    sessionLog(sessionId, '   ↳ scriptData.json 書き出し完了');

    // 出力パス
    const outDir = path.join(__dirname, 'out');
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
    const outputPath = path.join(outDir, `voice_comic_${timestamp}.mp4`);

    if (session.cancelled) throw new Error('CanceledByUser');

    // ── Remotion レンダリング ──
    sessionLog(sessionId, '🎬 [Remotion] 動画レンダリングパイプライン開始');
    const compositionId = 'VoiceComic';

    // Vite経由でバンドル
    sessionLog(sessionId, '📦 [Remotion] Webpack バンドル中... (TypeScript → JavaScript 変換)');
    const bundleStart = Date.now();
    const bundledPath = await bundle({
      entryPoint: path.join(__dirname, 'src', 'index.ts'),
      webpackOverride: (config) => config,
    });
    const bundleMs = Date.now() - bundleStart;
    sessionLog(sessionId, `   ↳ バンドル完了 (${(bundleMs / 1000).toFixed(1)}秒)`);

    sessionLog(sessionId, '🎥 [Remotion] コンポジション "VoiceComic" を抽出中...');
    const composition = await selectComposition({
      serveUrl: bundledPath,
      id: compositionId,
      inputProps: { scriptData },
    });

    // 動的に計算されたフレーム数をコンポジションに上書き設定
    composition.durationInFrames = scriptData.totalDurationInFrames;

    sessionLog(sessionId, `⏳ [Remotion] H.264エンコード開始: ${composition.durationInFrames}F / ${composition.width}×${composition.height} / 30fps`);
    let lastReportedPct = -1;
    await renderMedia({
      composition,
      serveUrl: bundledPath,
      codec: 'h264',
      outputLocation: outputPath,
      inputProps: { scriptData },
      onProgress: ({ renderedFrames }) => {
        if (session.cancelled) {
          throw new Error('CanceledByUser');
        }
        const pct = Math.floor((renderedFrames / composition.durationInFrames) * 100);
        if (pct >= lastReportedPct + 5) {
          lastReportedPct = pct;
          sessionLog(sessionId, `🎞️ レンダリング進捗: ${pct}%`);
        }
      },
    });

    session.status = 'complete';
    session.videoPath = outputPath;
    session.scriptData = scriptData;

    // 出力ファイルサイズを取得
    const outputStats = fs.statSync(outputPath);
    const fileSizeMB = (outputStats.size / (1024 * 1024)).toFixed(2);
    sessionLog(sessionId, `✅ [Generate] エンコード完了! → ${fileSizeMB} MB`);
    sessionLog(sessionId, `🎉 ボイスコミック動画の生成が完了しました!`);
    scheduleLogCleanup(sessionId);
    res.json({ videoPath: outputPath, scriptData });

  } catch (err) {
    console.error('❌ Generation error:', err);
    session.status = 'error';
    scheduleLogCleanup(sessionId);
    res.status(500).json({ error: err.message });
  } finally {
    releaseLock();
  }
});

// ──────────────────────────────────────
// API: 生成済み動画の配信
// ──────────────────────────────────────
app.get('/api/video/:sessionId', (req, res) => {
  const session = sessions.get(req.params.sessionId);
  if (!session?.videoPath || !fs.existsSync(session.videoPath)) {
    return res.status(404).json({ error: '動画が見つかりません' });
  }
  res.sendFile(session.videoPath);
});

// ──────────────────────────────────────
// ヘルパー関数
// ──────────────────────────────────────

/**
 * 話者のvoiceIdを返す（Casting v2でアサイン済みのvoiceIdを優先）
 * ※analyze側で性格ベースキャスティングが完了しているため、通常はvoiceIdがそのまま返る
 * ※フォールバック: voiceIdが未設定の場合のみ簡易推定を行う
 */
function getSpeakerId(dialogue) {
  if (dialogue.voiceId) return dialogue.voiceId;

  const speaker = dialogue.speaker || '';
  const gender = dialogue.gender || 'unknown';

  // ナレーション判定（拡張パターン）
  const narratorPatterns = ['ナレ', 'narr', '語り手', '地の文', 'ナレーター', 'ナレータ'];
  if (narratorPatterns.some(pat => speaker.toLowerCase().includes(pat.toLowerCase()))) return 2;

  // フォールバック: 性別ベースの簡易アサイン
  const hash = [...speaker].reduce((h, c) => h + c.charCodeAt(0), 0);
  const pool = gender === 'male' ? [11, 13, 12] : [10, 14, 8, 2, 16];
  const fallbackId = pool[hash % pool.length];
  console.log(`    🎭 [Casting Fallback] ${speaker} (${gender}) → Voice ID: ${fallbackId}`);
  return fallbackId;
}

/**
 * WAVバッファからDuration(秒)を取得
 */
function getWavDuration(wavBuffer) {
  try {
    const byteRate = wavBuffer.readUInt32LE(28);
    let offset = 12;
    while (offset < wavBuffer.length - 8) {
      const chunkId = wavBuffer.toString('ascii', offset, offset + 4);
      const chunkSize = wavBuffer.readUInt32LE(offset + 4);
      if (chunkId === 'data') {
        return chunkSize / byteRate;
      }
      offset += 8 + chunkSize;
    }
    return (wavBuffer.length - 44) / byteRate;
  } catch {
    return 3; // フォールバック3秒
  }
}

// ──────────────────────────────────────
// サーバー起動
// ──────────────────────────────────────
const server = app.listen(PORT, () => {
  console.log('');
  console.log('================================================');
  console.log(`  🚀 AI Voice Comic Maker Backend`);
  console.log(`  📡 http://localhost:${PORT}`);
  console.log('  📋 仕様: 画像ドロップのみ → AI全自動解析');
  console.log('================================================');
  console.log('');
});

// ポート衝突(EADDRINUSE)エラー時の安全ガード
server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error('');
    console.error('================================================');
    console.error(`❌ [Error] ポート ${PORT} は既に他のプロセスで使用されています。`);
    console.error(`   バックエンドサーバーが既に起動しているか、ゾンビプロセスが残っている可能性があります。`);
    console.error(`   ゾンビプロセスが残っている場合は、起動バッチを再起動するか、`);
    console.error(`   タスクマネージャー等で node.exe を終了させてください。`);
    console.error('================================================');
    console.error('');
    process.exit(1);
  }
});

// カスケードタイムアウト30分に追従し、Node.jsデフォルトの5分タイムアウトによる切断を防止
server.timeout = 30 * 60 * 1000; // 30分
