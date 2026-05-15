/**
 * Transition コンポーネント
 * 
 * コマ間のトランジションエフェクト
 */
import React from "react";
import {
  AbsoluteFill,
  useCurrentFrame,
  interpolate,
  useVideoConfig,
} from "remotion";

interface TransitionProps {
  /** トランジションタイプ */
  type?: "fade" | "wipe" | "zoom";
  /** フレーム数 */
  durationInFrames: number;
}

export const Transition: React.FC<TransitionProps> = ({
  type = "fade",
  durationInFrames,
}) => {
  const frame = useCurrentFrame();

  if (type === "fade") {
    const opacity = interpolate(
      frame,
      [0, durationInFrames],
      [1, 0],
      { extrapolateRight: "clamp" }
    );

    return (
      <AbsoluteFill
        style={{
          backgroundColor: "#000",
          opacity,
        }}
      />
    );
  }

  if (type === "wipe") {
    const progress = interpolate(
      frame,
      [0, durationInFrames],
      [0, 100],
      { extrapolateRight: "clamp" }
    );

    return (
      <AbsoluteFill
        style={{
          background: `linear-gradient(to right, transparent ${progress}%, #000 ${progress}%)`,
        }}
      />
    );
  }

  // zoom
  const scale = interpolate(
    frame,
    [0, durationInFrames],
    [1, 3],
    { extrapolateRight: "clamp" }
  );
  const opacity = interpolate(
    frame,
    [0, durationInFrames],
    [0, 1],
    { extrapolateRight: "clamp" }
  );

  return (
    <AbsoluteFill
      style={{
        backgroundColor: "#000",
        opacity,
        transform: `scale(${scale})`,
      }}
    />
  );
};
