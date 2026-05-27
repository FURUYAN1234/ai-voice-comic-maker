/**
 * VoiceComic メインコンポジション
 * 
 * 4コマ漫画の各コマを順番に表示し、
 * Ken Burnsエフェクト + セリフ音声 + 字幕 を重ねて
 * 縦型ショート動画を生成する。
 */
import React from "react";
import {
  AbsoluteFill,
  useCurrentFrame,
  useVideoConfig,
  Sequence,
  Img,
  Audio,
  staticFile,
  interpolate,
  spring,
} from "remotion";
import { ComicPanel } from "../components/ComicPanel";
import { Subtitle } from "../components/Subtitle";

// スクリプトデータの型定義
interface DialogueLine {
  /** セリフID（例: "line_01"） */
  id: string;
  /** 話者名 */
  speaker: string;
  /** セリフテキスト */
  text: string;
  /** コマ番号 (1-4) */
  panelIndex: number;
  /** 音声ファイルの長さ（フレーム数）- パイプラインで自動計算 */
  durationInFrames: number;
  /** 音声ファイルパス */
  audioFile: string;
  /** 吹き出しの左右位置（Gemini解析結果） */
  bubblePosition?: 'left' | 'center' | 'right';
}

interface ScriptData {
  /** 各コマの画像ファイルパス */
  panels: string[];
  /** セリフデータ */
  dialogues: DialogueLine[];
  /** 動画全体のフレーム数 */
  totalDurationInFrames: number;
  /** タイトル */
  title?: string;
  /** バージョン */
  version?: string;
  /** タイトルコール音声 */
  titleAudio?: string;
  /** タイトルカードのフレーム数 */
  titleDurationInFrames?: number;
  /** 漫画全体画像パス */
  originalImage?: string;
  /** 各コマのアスペクト比（動的ズーム用） */
  panelAspectRatios?: number[];
  /** 英語漫画判定フラグ */
  isEnglish?: boolean;
}

interface VoiceComicProps {
  scriptData: ScriptData;
}

export const VoiceComic: React.FC<VoiceComicProps> = ({ scriptData }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();

  // デフォルトデータ（プレビュー用）
  const data = scriptData || {
    panels: [],
    dialogues: [],
    totalDurationInFrames: 900,
  };

  // セリフごとのシーケンスを構築
  let currentFrame = 0;

  return (
    <AbsoluteFill
      style={{
        backgroundColor: "#000",
        fontFamily: "'Noto Sans JP', sans-serif",
      }}
    >
      {/* 背景グラデーション */}
      <AbsoluteFill
        style={{
          background: "linear-gradient(180deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)",
        }}
      />

      {/* AI自動作曲BGM (ループ再生) */}
      <Audio src={staticFile(data.bgmAudio || "audio/bgm.wav")} volume={0.4} loop />

      {/* タイトルコール */}
      {data.title && (
        <Sequence from={0} durationInFrames={data.titleDurationInFrames || 90}>
          <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", backgroundColor: "#000" }}>
            <div style={{ color: "#fff", fontSize: 60, fontWeight: "bold", textAlign: "center", padding: 40 }}>
              {data.title && data.title.startsWith("\u300c") && data.title.endsWith("\u300d") ? data.title : `\u300c${data.title}\u300d`}
            </div>
          </AbsoluteFill>
          {data.titleAudio && <Audio src={staticFile(data.titleAudio)} />}
        </Sequence>
      )}

      {/* 各セリフに対応するコマ＋音声＋字幕のシーケンス */}
      {data.dialogues.map((dialogue, index) => {
        // タイトルコールがある場合は titleDurationInFrames 後から開始
        const titleDuration = data.titleDurationInFrames || 90;
        const startFrame = currentFrame + (data.title ? titleDuration : 0);
        const duration = dialogue.durationInFrames || fps * 3; // デフォルト3秒
        currentFrame += duration;

        return (
          <Sequence
            key={dialogue.id}
            from={startFrame}
            durationInFrames={duration}
          >
            {/* コマ画像（右から左へのパンエフェクト付き） */}
            <ComicPanel
              src={staticFile(data.panels[dialogue.panelIndex] || "")}
              durationInFrames={duration}
              bubblePosition={dialogue.bubblePosition}
              panelAspectRatio={data.panelAspectRatios?.[dialogue.panelIndex]}
            />

            {/* セリフ音声 */}
            {dialogue.audioFile && (
              <Audio src={staticFile(dialogue.audioFile)} />
            )}

            {/* 字幕 */}
            <Subtitle
              text={dialogue.text}
              speaker={dialogue.speaker}
              durationInFrames={duration}
            />
          </Sequence>
        );
      })}

      {/* アウトロシーケンス */}
      {data.dialogues.length > 0 && (
        <Sequence
          from={currentFrame + (data.title ? (data.titleDurationInFrames || 90) : 0)}
          durationInFrames={180}
        >
          <AbsoluteFill style={{ backgroundColor: "#0f172a", justifyContent: "center", alignItems: "center" }}>
            {/* 漫画全体画像を背景に表示 */}
            {data.originalImage && (
              <Img
                src={staticFile(data.originalImage)}
                style={{
                  position: "absolute",
                  width: "100%",
                  height: "100%",
                  objectFit: "contain",
                  opacity: 0.5, // テキストが読みやすいように暗くする
                }}
              />
            )}
            
            <div style={{ color: "#fff", fontSize: 40, textAlign: "center", fontWeight: "bold", zIndex: 10, textShadow: "0px 4px 16px rgba(0,0,0,0.9)" }}>
              {data.isEnglish ? (
                <>
                  Fully Automated & Autonomous<br/>AI Manga Video System<br/>
                </>
              ) : (
                <>
                  ネームから全自動の<br/>自律式統合AI漫画システム<br/>
                </>
              )}
              <span style={{ color: "#38bdf8", fontSize: 32, marginTop: 40, display: "block", textShadow: "0px 2px 8px rgba(0,0,0,0.8)" }}>
                https://note.com/happy_duck780
              </span>
            </div>
            
            {/* クレジット表記 - 視認性向上 */}
            <div style={{
              position: "absolute",
              bottom: 30,
              left: 0,
              right: 0,
              backgroundColor: "rgba(0,0,0,0.6)",
              padding: "16px 40px",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "flex-end",
            }}>
              <div style={{
                color: "rgba(255,255,255,0.9)",
                fontSize: 22,
                fontWeight: "bold",
                textShadow: "0px 2px 4px rgba(0,0,0,0.8)",
              }}>
                Created with Remotion<br/>
                <span style={{ fontSize: 20 }}>
                  {data.isEnglish ? "Audio: Microsoft Edge-TTS" : "音声：VOICEVOX"}
                </span>
              </div>
              <div style={{
                color: "rgba(255,255,255,0.9)",
                fontSize: 22,
                fontWeight: "bold",
                textAlign: "right",
                textShadow: "0px 2px 4px rgba(0,0,0,0.8)",
              }}>
                AI Voice Comic Maker<br/>
                <span style={{ fontSize: 18 }}>v{data.version || '1.5.7'}</span>
              </div>
            </div>
          </AbsoluteFill>
        </Sequence>
      )}

      {/* データがない場合のプレースホルダー表示 */}
      {data.dialogues.length === 0 && (
        <AbsoluteFill
          style={{
            justifyContent: "center",
            alignItems: "center",
            color: "#fff",
            fontSize: 32,
            textAlign: "center",
            padding: 40,
          }}
        >
          <div>
            <div style={{ fontSize: 64, marginBottom: 20 }}>🎬</div>
            <div>AI Voice Comic Maker v{data.version || '1.5.7'}</div>
            <div style={{ fontSize: 20, opacity: 0.6, marginTop: 10 }}>
              input/ フォルダに漫画画像とJSONを配置して
              <br />
              パイプラインを実行してください
            </div>
          </div>
        </AbsoluteFill>
      )}
    </AbsoluteFill>
  );
};
