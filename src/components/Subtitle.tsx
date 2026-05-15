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

  const translateY = interpolate(slideUp, [0, 1], [60, 0]);

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
        justifyContent: "flex-end",
        alignItems: "center",
        paddingBottom: 120,
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
  const colorMap: Record<string, string> = {
    // デフォルトのキャラクターカラー
    "ずんだもん": "#7BC67E",
    "四国めたん": "#E8639A",
    "春日部つむぎ": "#F8B500",
    "九州そら": "#6EAADC",
    "波音リツ": "#E8476E",
    "雨晴はう": "#35A7FF",
    "玄野武宏": "#4A90D9",
    "白上虎太郎": "#FF8C00",
    // キャラA/B（remotion_video_2互換）
    "アカリ": "#F8B500",
    "ヒカリ": "#6EAADC",
    // 汎用
    "A": "#F8B500",
    "B": "#6EAADC",
  };

  return colorMap[speaker] || "#888";
}
