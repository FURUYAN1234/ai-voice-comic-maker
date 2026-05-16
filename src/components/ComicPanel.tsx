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
  // 常にカメラが「右から左」へパンするように、画像の left 位置は「左から右」へ移動させる。
  // scale による拡大と組み合わせても黒枠が見えないように、オフセットを調整。
  let startX = 0;
  let endX = 0;
  if (bubblePosition === 'left') {
    startX = -10;
    endX = 0;
  } else if (bubblePosition === 'right') {
    startX = -100;
    endX = -90;
  } else {
    startX = -55;
    endX = -45;
  }

  const posX = interpolate(frame, [0, durationInFrames], [startX, endX], {
    extrapolateRight: "clamp",
  });

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
            left: `${posX}%`,
            transformOrigin: "center center",
            transform: `translateY(-50%) scale(${scale})`, // 上下中央揃え ＋ 緩やかなズーム
          }}
        />
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
