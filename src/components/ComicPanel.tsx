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

  // ── 動的パンオフセット計算（吹き出し位置追従カメラ v2） ──
  // overflowPct: 画像がビューポートからはみ出す割合（%）
  // 例: imageWidthPct=250% → overflowPct=150 → 画像の左右にそれぞれ75%分の余白
  const overflowPct = Math.max(0, imageWidthPct - 100);
  // パン演出の移動幅（ゆっくりスライドするKen Burns効果）
  const panRange = Math.min(8, overflowPct * 0.08);

  // 各位置の基準オフセット（left%値。負=画像を左にずらす=右側が見える）
  // center: 画像の中心がビューポート中心に来る位置
  const centerX = -(overflowPct / 2);

  let startX = 0;
  let endX = 0;

  if (bubblePosition === 'right') {
    // 右側の吹き出しにフォーカス: 画像を大きく左にずらして右側を表示
    // overflowPctの95%分シフト（ほぼ右端まで寄せる）
    const targetX = -overflowPct * 0.95;
    startX = targetX;
    endX = targetX + panRange; // 少しだけ中央方向にゆっくりパン
  } else if (bubblePosition === 'left') {
    // 左側の吹き出しにフォーカス: 画像をほぼそのまま（左端を表示）
    // overflowPctの5%分だけ左にずらす（左端ギリギリ）
    const targetX = -overflowPct * 0.05;
    startX = targetX;
    endX = targetX - panRange; // 少しだけ左方向にゆっくりパン
  } else {
    // center: 中央に配置し、わずかにパン
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
