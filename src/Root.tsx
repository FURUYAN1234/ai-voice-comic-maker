/**
 * Remotion Root コンポーネント
 * 
 * コンポジション（動画テンプレート）の登録
 */
import React from "react";
import { Composition } from "remotion";
import { VoiceComic } from "./compositions/VoiceComic";

// デフォルトの動画設定（9:16 縦型）
const COMIC_WIDTH = 1080;
const COMIC_HEIGHT = 1920;
const FPS = 30;

// デフォルトのフレーム数（音声尺により動的に変わる）
const DEFAULT_DURATION_FRAMES = 30 * FPS; // 30秒

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="VoiceComic"
        component={VoiceComic}
        durationInFrames={DEFAULT_DURATION_FRAMES}
        fps={FPS}
        width={COMIC_WIDTH}
        height={COMIC_HEIGHT}
        defaultProps={{
          scriptData: {
            panels: [],
            dialogues: [],
            totalDurationInFrames: DEFAULT_DURATION_FRAMES,
          },
        }}
      />
    </>
  );
};
