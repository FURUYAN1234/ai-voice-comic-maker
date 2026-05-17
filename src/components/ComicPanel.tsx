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

  // ── 動的ズーム計算 ──
  // パネルのアスペクト比に応じて、ビューポート高さの TARGET_FILL を埋めるように
  // 画像の表示幅を動的に算出する（横長パネルほどズームイン）
  const TARGET_FILL = 0.55; // ビューポート高さの55%をパネルで埋める（広角寄り）
  const MIN_WIDTH_PCT = 200; // 最小幅（パン演出に必要な余裕）
  const MAX_WIDTH_PCT = 350; // 最大幅（人物が切れない程度に抑制）

  const videoAR = videoWidth / videoHeight; // 9:16 = 0.5625
  const panelAR = panelAspectRatio || 2; // デフォルト2:1（未指定時）
  // 目標: imageHeight / videoHeight = TARGET_FILL
  //   imageHeight = imageWidth / panelAR
  //   imageWidth = imageWidthPct / 100 * videoWidth
  //   → imageWidthPct = TARGET_FILL * panelAR / videoAR * 100
  const idealWidthPct = (TARGET_FILL * panelAR / videoAR) * 100;
  const imageWidthPct = Math.max(MIN_WIDTH_PCT, Math.min(MAX_WIDTH_PCT, idealWidthPct));

  // 少しズームインしながらパンする演出（迫力アップ）
  const scale = interpolate(frame, [0, durationInFrames], [1.05, 1.15], {
    extrapolateRight: "clamp",
  });

  // フェードイン（最初の0.3秒）
  const fadeIn = interpolate(frame, [0, Math.floor(fps * 0.3)], [0, 1], {
    extrapolateRight: "clamp",
  });

  // ── 動的パンオフセット計算 ──
  // 画像幅に比例してパン範囲を算出（黒枠が出ないよう scale 最小値で安全マージン確認済み）
  const overflowPct = imageWidthPct - 100; // ビューポートからのはみ出し量
  const scaleBonus = imageWidthPct * 0.05; // scale 1.05 時の追加余白
  const panRange = 10; // パン幅（全ポジション共通）

  let startX = 0;
  let endX = 0;
  if (bubblePosition === 'left') {
    // 画像の左端にフォーカス
    endX = scaleBonus;
    startX = endX - panRange;
  } else if (bubblePosition === 'right') {
    // 画像の右端にフォーカス
    startX = -overflowPct;
    endX = startX + panRange;
  } else {
    // 中央
    const centerX = -(overflowPct / 2);
    startX = centerX - panRange / 2;
    endX = centerX + panRange / 2;
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
        {/* メインのコマ画像（動的幅でアスペクト比に応じたズーム） */}
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
