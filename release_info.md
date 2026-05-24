v1.4.6: Expanded Pronunciation Dictionary for Alphanumeric Terms / 発音補正辞書の大幅拡充による英数字誤読の改善

## What's New / 更新内容
- **Expanded Pronunciation Dictionary (発音補正辞書の大幅拡充)**:
  Expanded the preset pronunciation dictionary (`PRONUNCIATION_DICT`) in `server.js` to include a wide variety of numeric and alphanumeric terms across multiple genres (gaming consoles, gadgets, OS, AI models, network standards, military, science). This prevents the voice synthesis engine from misreading terms like "Switch2" as "Switch-ni" (interpreting "2" as "ni"), ensuring natural Japanese vocalizations for modern technical and pop-culture terms. / 音声合成時の誤読を防止するため、`server.js` 内の発音補正辞書（`PRONUNCIATION_DICT`）を大幅に拡充しました。最新のゲーム機（Switch2, PS5 Pro）、ガジェット（Quest 3, iPhone 16）、OS（Windows 11）、主要AIモデル（GPT-4o, Claude 3.5）、通信規格（5G, Wi-Fi 7）、ミリタリー・科学用語（F-15, CO2）など、AI漫画で頻出する多様な英数字交じりの用語を追加。これにより、「Switch2」が「スイッチに」と読まれてしまうような英数字の誤読バグを根本から解消しました。
