/**
 * ComicPanel コンポーネント
 * 
 * Ken Burnsエフェクト（ゆっくりとしたズーム・パン）付きの
 * コマ画像表示コンポーネント
 */
import React from "react";
import {
  AbsoluteFill,
  useCurrentFrame,
  interpolate,
  Img,
  spring,
  useVideoConfig,
} from "remotion";

interface ComicPanelProps {
  /** コマ画像のパス */
  src: string;
  /** 表示フレーム数 */
  durationInFrames: number;
  /** 吹き出しの左右位置 */
  bubblePosition?: string;
}

export const ComicPanel: React.FC<ComicPanelProps> = ({
  src,
  durationInFrames,
  bubblePosition = 'center',
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // 少しズームインしながらパンする演出（迫力アップ）
  const scale = interpolate(frame, [0, durationInFrames], [1.05, 1.15], {
    extrapolateRight: "clamp",
  });

  // フェードイン（最初の0.3秒）
  const fadeIn = interpolate(frame, [0, Math.floor(fps * 0.3)], [0, 1], {
    extrapolateRight: "clamp",
  });

  // 話者位置に応じた表示領域の設定
  // width: 200% にして、画面幅のちょうど半分（左側・中央・右側）を映す
  const leftPos = bubblePosition === 'left' ? "0%" : bubblePosition === 'right' ? "-100%" : "-50%";
  const origin = bubblePosition === 'left' ? "left center" : bubblePosition === 'right' ? "right center" : "center center";

  if (!src) return null;

  return (
    <AbsoluteFill style={{ opacity: fadeIn, backgroundColor: "#000" }}>
      <AbsoluteFill
        style={{
          justifyContent: "center",
          alignItems: "center",
          overflow: "hidden",
        }}
      >
        {/* 背景のぼかし（隙間を埋める） */}
        <Img
          src={src}
          style={{
            position: "absolute",
            width: "100%",
            height: "100%",
            objectFit: "cover",
            filter: "blur(20px)",
            opacity: 0.6,
            transform: `scale(1.1)`,
          }}
        />
        {/* メインのコマ画像（幅200%で対象キャラをバシッと映す） */}
        <Img
          src={src}
          style={{
            position: "absolute",
            width: "200%",
            height: "auto",
            top: "50%",
            left: leftPos,
            transformOrigin: origin,
            transform: `translateY(-50%) scale(${scale})`, // 上下中央揃え ＋ 緩やかなズーム
          }}
        />
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
