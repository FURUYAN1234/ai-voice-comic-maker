/**
 * Subtitle コンポーネント
 * 
 * セリフ字幕を画面下部にオーバーレイ表示する。
 * 話者名とセリフテキストをリッチに表示。
 */
import React from "react";
import {
  AbsoluteFill,
  useCurrentFrame,
  interpolate,
  spring,
  useVideoConfig,
} from "remotion";

interface SubtitleProps {
  /** セリフテキスト */
  text: string;
  /** 話者名 */
  speaker: string;
  /** 表示フレーム数 */
  durationInFrames: number;
}

export const Subtitle: React.FC<SubtitleProps> = ({
  text,
  speaker,
  durationInFrames,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // 字幕のスライドインアニメーション
  const slideUp = spring({
    frame,
    fps,
    config: {
      damping: 20,
      stiffness: 100,
    },
  });

  const translateY = interpolate(slideUp, [0, 1], [-60, 0]);

  // フェードアウト（最後の0.3秒）
  const fadeOut = interpolate(
    frame,
    [durationInFrames - Math.floor(fps * 0.3), durationInFrames],
    [1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  // 話者ごとの色分け
  const speakerColor = getSpeakerColor(speaker);

  return (
    <AbsoluteFill
      style={{
        justifyContent: "flex-start",
        alignItems: "center",
        paddingTop: 150, // 画面上部からのマージン
        opacity: fadeOut,
      }}
    >
      <div
        style={{
          transform: `translateY(${translateY}px)`,
          maxWidth: "90%",
          textAlign: "center",
        }}
      >
        {/* 話者名 */}
        <div
          style={{
            display: "inline-block",
            backgroundColor: speakerColor,
            color: "#fff",
            fontSize: 22,
            fontWeight: 700,
            padding: "4px 16px",
            borderRadius: 8,
            marginBottom: 8,
            fontFamily: "'Noto Sans JP', sans-serif",
          }}
        >
          {speaker}
        </div>

        {/* セリフテキスト */}
        <div
          style={{
            backgroundColor: "rgba(0, 0, 0, 0.75)",
            backdropFilter: "blur(8px)",
            color: "#fff",
            fontSize: 36,
            fontWeight: 600,
            lineHeight: 1.5,
            padding: "16px 28px",
            borderRadius: 16,
            textShadow: "0 2px 8px rgba(0,0,0,0.8)",
            fontFamily: "'Noto Sans JP', sans-serif",
          }}
        >
          {text}
        </div>
      </div>
    </AbsoluteFill>
  );
};

/**
 * 話者名からテーマカラーを取得
 * VOICEVOXキャラクターのイメージカラーに合わせる
 */
function getSpeakerColor(speaker: string): string {
  // 既知のVOICEVOXキャラクター → イメージカラー
  const colorMap: Record<string, string> = {
    "ずんだもん": "#7BC67E",
    "四国めたん": "#E8639A",
    "春日部つむぎ": "#F8B500",
    "九州そら": "#6EAADC",
    "波音リツ": "#E8476E",
    "雨晴はう": "#35A7FF",
    "玄野武宏": "#4A90D9",
    "白上虎太郎": "#FF8C00",
    "冥鳴ひまり": "#9B59B6",
    "青山龍星": "#2ECC71",
    "アカリ": "#F8B500",
    "ヒカリ": "#6EAADC",
    "A": "#F8B500",
    "B": "#6EAADC",
    "ナレーション": "#888",
  };

  if (colorMap[speaker]) return colorMap[speaker];

  // 未知のキャラ名 → ハッシュベースでHSLカラーを動的生成
  let hash = 0;
  for (let i = 0; i < speaker.length; i++) {
    hash = (hash * 31 + speaker.charCodeAt(i)) & 0xFFFFFF;
  }
  const hue = hash % 360;
  const saturation = 55 + (hash % 25);   // 55-80%（彩度高め）
  const lightness = 48 + (hash % 12);    // 48-60%（暗すぎず明るすぎず）
  return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
}
