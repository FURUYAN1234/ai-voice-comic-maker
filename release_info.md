v1.3.8: Preset Pronunciation Dictionary & OCR Prompt Hardening / プリセット発音辞書導入＆OCRプロンプト厳格化

## What's New / 更新内容
- VOICEVOX音声合成向けにIT用語やネットスラングなどを含む約450ワードのプリセット発音辞書を導入し、読み間違いを自動補正。/ Introduced a preset pronunciation dictionary of ~450 words including IT terms and net slang for VOICEVOX synthesis to auto-correct misreadings.
- Vision OCRのプロンプトを厳格化し、セリフの一字一句正確な転写とGemini API呼び出し時の温度設定(temperature: 0.1)による言い換えの抑制を実現。/ Hardened Vision OCR prompt to enforce word-for-word transcriptions and lowered temperature to 0.1 to suppress LLM paraphrasing.
