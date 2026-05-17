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
  /** コマのアスペクト比（幅/高さ）— 動的ズーム計算用 */
  panelAspectRatio?: number;
}

export const ComicPanel: React.FC<ComicPanelProps> = ({
  src,
  durationInFrames,
  bubblePosition = 'center',
  panelAspectRatio,
}) => {
  const frame = useCurrentFrame();
  const { fps, width: videoWidth, height: videoHeight } = useVideoConfig();

  // ── 動的ズーム計算（width制約方式） ──
  const TARGET_FILL = 0.50; // ビューポート高さの50%をパネルで埋める
  const MAX_WIDTH_PCT = 350;

  const videoAR = videoWidth / videoHeight; // 9:16 = 0.5625
  const panelAR = panelAspectRatio || 2;
  const idealWidthPct = (TARGET_FILL * panelAR / videoAR) * 100;

  // 安全キャップ: scale最大値でも画像高さがビューポートを超えない幅の上限
  const SCALE_END = 1.08;
  const safeMaxWidthPct = (videoHeight * panelAR / videoWidth / SCALE_END) * 100;

  // safeMaxWidthPctを最終的な上限とする（MIN_WIDTH_PCTより優先）
  const imageWidthPct = Math.min(safeMaxWidthPct, Math.max(130, Math.min(MAX_WIDTH_PCT, idealWidthPct)));

  // 少しズームインしながらパンする演出
  const scale = interpolate(frame, [0, durationInFrames], [1.02, SCALE_END], {
    extrapolateRight: "clamp",
  });

  // フェードイン（最初の0.3秒）
  const fadeIn = interpolate(frame, [0, Math.floor(fps * 0.3)], [0, 1], {
    extrapolateRight: "clamp",
  });

  // ── 動的パンオフセット計算 ──
  const overflowPct = Math.max(0, imageWidthPct - 100);
  const panRange = Math.min(10, overflowPct * 0.15);

  let startX = 0;
  let endX = 0;
  if (overflowPct > 5) {
    if (bubblePosition === 'left') {
      endX = Math.min(overflowPct * 0.05, overflowPct * 0.3);
      startX = endX - panRange;
    } else if (bubblePosition === 'right') {
      startX = -overflowPct * 0.8;
      endX = startX + panRange;
    } else {
      const centerX = -(overflowPct / 2);
      startX = centerX - panRange / 2;
      endX = centerX + panRange / 2;
    }
  } else {
    const centerX = -(overflowPct / 2);
    startX = centerX - 1;
    endX = centerX + 1;
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
        {/* メインのコマ画像 */}
        <Img
          src={src}
          style={{
            position: "absolute",
            width: `${imageWidthPct}%`,
            height: "auto",
            top: "50%",
            left: `${posX}%`,
            transformOrigin: "center center",
            transform: `translateY(-50%) scale(${scale})`,
          }}
        />
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
