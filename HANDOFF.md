# HANDOFF

## Last Updated
2026-06-21 22:45 JST

## Last Agent
Codex

## App Root
<Antigravity>\short_movie

## Current Version
v1.8.5

## Current Goal
**Supertonic 3 TTS Engine Integration** - Add Supertonic 3 as a fallback & user-selectable TTS engine alongside VOICEVOX.

## Codex Correction Update (2026-06-21 22:15 JST)

Supertonic 3 was verified with a real manga generation after the user entered the API key in the UI. No version bump, release, deploy, or backup was run.

### Completed After User Verification
- Fixed frontend request wiring so the selected TTS engine is sent to both `POST /api/analyze/:sessionId` and `POST /api/generate/:sessionId`.
- Fixed DROP / GENERATING status labels and casting preview so Supertonic selection is no longer presented as VOICEVOX.
- Fixed backend analysis and generation flow so `ttsEngine=supertonic` produces Supertonic casting and Supertonic audio instead of falling back to VOICEVOX casting labels.
- Added final MP4 audio normalization with ffmpeg `loudnorm=I=-14:TP=-1.5:LRA=11` so Supertonic output is boosted to practical VOICEVOX-like loudness.
- Raised Remotion mix levels for BGM and dialogue/title audio.
- Removed the extra `音声ONで再生` UI button. The completed screen is back to the normal video controls plus download/reset/share actions.

### Real Generation Proof
- A real Japanese manga generation was completed with `ttsEngine=supertonic`.
- The generated verification artifacts were removed before release/build packaging.
- Backend log showed `[TTS Selection] requested=supertonic effective=supertonic`.
- Backend log showed Supertonic dialogue synthesis for 8 lines plus Supertonic title call.
- Backend log showed `✅ [Audio Normalize] 音量正規化完了`.
- `ffprobe` confirmed AAC audio stream: 48 kHz, stereo, 36.2 seconds.
- `ffmpeg volumedetect` on the final MP4: mean volume `-16.9 dB`, max volume `-1.4 dB`.
- Before normalization, the earlier Supertonic MP4 measured around `-28.9 dBFS`, so the final result is roughly 12 dB louder.
- The final MP4 was opened directly in Windows `映画 & テレビ`, and the user confirmed the Windows app version produced sound.

### Verification
- `node --check server.js`
- `node scripts\pre_deploy_check.js`
- `npm run build`
- `git diff --check -- . ':!dist' ':!out' ':!temp'` (CRLF warnings only)
- `GET http://127.0.0.1:3001/api/supertonic/status` returned connected Supertonic 3: version `1.3.1`, model `supertonic-3`, 10 voices loaded.
- Served Vite source on `http://127.0.0.1:5174/src/App.jsx` no longer contains `音声ONで再生`, `handlePlayWithSound`, or `videoRef`.

## Codex Implementation Update (2026-06-21 21:05 JST)

Implemented the Supertonic 3 integration locally. No version bump, release, deploy, or backup was run.

### Completed
- `server.js`
  - Added `GET /api/supertonic/status` for `localhost:7789/v1/health`.
  - Added Supertonic voice pools, emotion tag mapping, status helpers, and `/v1/tts` synthesis.
  - Resamples Supertonic WAV output to 24 kHz mono PCM through the existing Remotion ffmpeg path.
  - Stores `supertonicVoiceId` during analysis while preserving existing VOICEVOX/Edge `voiceId`.
  - Reads `ttsEngine` from `POST /api/generate/:sessionId` body.
  - Supports `auto`, `voicevox`, and `supertonic`; English remains Edge-TTS unless `supertonic` is explicitly selected.
  - Adds Supertonic title-call generation and writes `scriptData.ttsEngine` for Remotion credits.
- `src/App.jsx`
  - Added Supertonic status state and setup status display.
  - Allows setup to proceed when either VOICEVOX or Supertonic is connected, plus API key validity.
  - Added DROP-phase TTS selector: Auto / VOICEVOX / Supertonic 3.
  - Sends `{ ttsEngine }` to `POST /api/generate/:sessionId`.
- `src/compositions/VoiceComic.tsx`
  - Adds `ttsEngine` to `ScriptData`.
  - Shows `Sound: Supertonic 3` when Supertonic is used.
- `start_ai-voice-comic-maker.bat`
  - Makes VOICEVOX startup non-blocking after repeated failure so fallback can proceed.
  - Checks Python, installs `supertonic[serve]` with `python -m pip` if missing, and starts `supertonic serve --host 127.0.0.1 --port 7789`.
  - Uses ASCII-only echo messages.

### Verification
- `node --check server.js`
- `node scripts\pre_deploy_check.js`
- `npm run build`
- `git diff --check -- . ':!dist' ':!out' ':!temp'` (CRLF warnings only)
- Local dev server started with Vite on `http://127.0.0.1:5174` and API on `http://127.0.0.1:3001`.
- `GET http://127.0.0.1:3001/api/supertonic/status` returned `{"connected":false}` cleanly when Supertonic was not running.
- In-app browser on port 5174 showed the Supertonic 3 setup status block.

### Earlier Gap Now Closed
- Full manga generation with Supertonic audio was verified in the 22:15 JST correction update above.
- DROP-phase selector and selected-engine propagation were verified by the real Supertonic run.

## Background & Design Decision
User read a techno-edge.net article about Supertonic 3 (by Supertone Inc.), a lightweight 99M-parameter TTS model that runs fully local on CPU with 31-language support including Japanese. User wants to integrate it as an alternative TTS to VOICEVOX.

**Key Decision**: Supertonic 3 runs as a Python HTTP server (`supertonic serve`) with REST API at `localhost:7789`, same pattern as VOICEVOX at `localhost:50021`. This avoids complex ONNX Runtime native binding setup in Node.js.

## Architecture Overview

### Current TTS Flow
```
Japanese manga  -> VOICEVOX (localhost:50021) -> 24kHz WAV
English manga   -> Edge TTS (Microsoft cloud) -> MP3 -> ffmpeg -> 24kHz WAV
```

### Target TTS Flow
```
Japanese manga  -> User selection:
                     "auto"       -> VOICEVOX if available, else Supertonic 3 fallback
                     "voicevox"   -> VOICEVOX only
                     "supertonic" -> Supertonic 3 only
English manga   -> Edge TTS (unchanged)
                   OR Supertonic 3 (if explicitly selected, supports 31 langs)
```

## Implementation Plan (DETAILED)

### 1. start_ai-voice-comic-maker.bat - Add Supertonic 3 auto-install & startup

Insert AFTER the existing VOICEVOX check block (after `:LAUNCH_APP` label definition but before `call npm run dev`):

```batch
REM --- Supertonic 3 TTS Engine Check ---
echo [INFO] Checking Supertonic 3 TTS Engine...

REM Check if Python is installed
where python >nul 2>nul
if errorlevel 1 (
    echo [WARN] Python is not installed. Supertonic 3 will not be available.
    echo [WARN] VOICEVOX will be used as the primary TTS engine.
    goto LAUNCH_APP
)

REM Check if supertonic package is installed
python -c "import supertonic" >nul 2>nul
if errorlevel 1 (
    echo [INFO] Supertonic 3 not found. Installing via pip...
    pip install "supertonic[serve]"
    if errorlevel 1 (
        echo [WARN] Failed to install Supertonic 3. Continuing without it.
        goto LAUNCH_APP
    )
)

REM Check if supertonic serve is already running
curl -s -o nul -w "%%{http_code}" http://127.0.0.1:7789/v1/health > "%TEMP%\st_status.txt" 2>nul
set /p STSTATUS=<"%TEMP%\st_status.txt"
del "%TEMP%\st_status.txt" 2>nul
if "!STSTATUS!"=="200" (
    echo [OK] Supertonic 3 serve is already running.
    goto LAUNCH_APP
)

REM Start supertonic serve in background
echo [INFO] Starting Supertonic 3 serve on port 7789...
start /B supertonic serve --host 127.0.0.1 --port 7789

:WAIT_ST
echo [INFO] Waiting for Supertonic 3 to respond...
timeout /t 3 /nobreak >nul
curl -s -o nul -w "%%{http_code}" http://127.0.0.1:7789/v1/health > "%TEMP%\st_status.txt" 2>nul
set /p ST_RECHECK=<"%TEMP%\st_status.txt"
del "%TEMP%\st_status.txt" 2>nul
if "!ST_RECHECK!"=="200" (
    echo [OK] Supertonic 3 is ready.
    goto LAUNCH_APP
)
REM If Supertonic fails to start after a few attempts, continue anyway
echo [WARN] Supertonic 3 did not start. Continuing with VOICEVOX only.
```

**IMPORTANT**: All echo messages MUST be in English (ASCII only) per project rules for .bat files.

### 2. server.js - Backend changes (4 additions)

#### 2a. Add Supertonic 3 status API (insert near line 1826, after Edge-TTS status)

```javascript
// API: Supertonic 3 TTS status check
app.get('/api/supertonic/status', async (req, res) => {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const response = await fetch('http://127.0.0.1:7789/v1/health', {
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (response.ok) {
      const data = await response.json();
      res.json({ connected: true, version: data.version || 'unknown', model: data.model || 'supertonic-3' });
    } else {
      res.json({ connected: false });
    }
  } catch {
    res.json({ connected: false });
  }
});
```

#### 2b. Add Supertonic 3 voice casting (insert near the EDGE_TTS_VOICES block, ~line 1400)

```javascript
// Supertonic 3 voice pools (personality x gender mapping)
const SUPERTONIC_VOICE_POOLS = {
  male: {
    energetic: ['M5', 'M2'],  // M5=powerful, M2=young
    calm:      ['M4', 'M1'],  // M4=soft, M1=standard
    cool:      ['M3', 'M5'],  // M3=deep, M5=powerful
    cute:      ['M2', 'M1'],  // M2=young, M1=standard
  },
  female: {
    energetic: ['F2', 'F5'],  // F2=young, F5=powerful
    calm:      ['F4', 'F1'],  // F4=soft, F1=standard
    cool:      ['F3', 'F5'],  // F3=deep, F5=powerful
    cute:      ['F2', 'F1'],  // F2=young, F1=standard
  },
  unknown: {
    energetic: ['F2', 'M2'],
    calm:      ['F1', 'M1'],
    cool:      ['F3', 'M3'],
    cute:      ['F2', 'M2'],
  }
};

// Supertonic 3 emotion -> expression tag mapping
const SUPERTONIC_EMOTION_TAGS = {
  happy:     { suffix: ' <laugh>' },
  excited:   { suffix: ' <laugh>' },
  sad:       { suffix: ' <sigh>' },
  worried:   { suffix: ' <sigh>' },
  surprised: { prefix: '<breath> ' },
  angry:     {},  // no tag, rely on text intonation
  neutral:   {},
};

function assignSupertonicVoice(speaker, gender, personality, usedVoices) {
  // Narrator detection
  const narratorPatterns = ['narr', 'narrator', 'nare', 'katari', 'jibun'];
  if (narratorPatterns.some(pat => speaker.toLowerCase().includes(pat.toLowerCase()))) {
    return gender === 'male' ? 'M3' : 'F3'; // deep/calm for narrator
  }

  const genderKey = SUPERTONIC_VOICE_POOLS[gender] ? gender : 'unknown';
  const pool = SUPERTONIC_VOICE_POOLS[genderKey][personality] || SUPERTONIC_VOICE_POOLS[genderKey].calm;

  const unusedPool = pool.filter(v => !usedVoices.has(v));
  const selectFrom = unusedPool.length > 0 ? unusedPool : pool;
  const hash = [...speaker].reduce((h, c) => h + c.charCodeAt(0), 0);
  const selected = selectFrom[hash % selectFrom.length];
  usedVoices.add(selected);
  return selected;
}
```

#### 2c. Add Supertonic 3 synthesis function (insert near synthesizeWithEdgeTts, ~line 1432)

```javascript
async function synthesizeWithSupertonic(text, voiceName, lang, emotion, outputPath, sessionId) {
  // Apply emotion expression tags
  const emotionConfig = SUPERTONIC_EMOTION_TAGS[emotion] || {};
  let taggedText = text;
  if (emotionConfig.prefix) taggedText = emotionConfig.prefix + taggedText;
  if (emotionConfig.suffix) taggedText = taggedText + emotionConfig.suffix;

  // Call Supertonic 3 serve API
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  const response = await fetch('http://127.0.0.1:7789/v1/tts', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      text: taggedText,
      voice: voiceName,
      lang: lang || 'ja',
      speed: 1.05,
      total_steps: 8,
    }),
    signal: controller.signal,
  });
  clearTimeout(timeout);

  if (!response.ok) throw new Error(`Supertonic synthesis failed: ${response.status}`);
  const wavBuffer44k = Buffer.from(await response.arrayBuffer());

  // Save 44.1kHz WAV to temp file, then resample to 24kHz with ffmpeg
  const temp44kPath = outputPath.replace(/\.wav$/i, '.tmp44k.wav');
  fs.writeFileSync(temp44kPath, wavBuffer44k);

  try {
    execFileSync(FFMPEG_PATH, [
      '-y', '-i', temp44kPath,
      '-ar', '24000', '-ac', '1', '-sample_fmt', 's16', '-f', 'wav',
      outputPath
    ], { timeout: 15000, stdio: 'pipe' });
  } finally {
    try { fs.unlinkSync(temp44kPath); } catch (_) {}
  }

  // Calculate duration from resampled WAV
  const wavSize = fs.statSync(outputPath).size;
  const pcmDataSize = Math.max(0, wavSize - 44);
  const duration = pcmDataSize / 48000; // 24000Hz * 1ch * 2bytes

  if (sessionId) {
    sessionLog(sessionId, `   🔊 [Supertonic] ${voiceName} → ${path.basename(outputPath)} (${duration.toFixed(2)}s)`);
  }
  return duration;
}
```

#### 2d. Modify generate API pipeline (~line 2780)

The main synthesis loop needs a 3-way branch based on the `ttsEngine` parameter:

```
Currently: if (isEnglish) { Edge-TTS } else { VOICEVOX }

Target:    if (ttsEngine === 'supertonic') {
             Supertonic 3 for all languages
           } else if (isEnglish) {
             Edge TTS (unchanged)
           } else if (ttsEngine === 'voicevox') {
             VOICEVOX (unchanged)
           } else {
             // "auto" mode
             try VOICEVOX first, if connection fails, fall back to Supertonic 3
           }
```

The `ttsEngine` param comes from frontend via `POST /api/generate/:id` request body.

The casting block (~line 2480) also needs a branch: when `ttsEngine === 'supertonic'`, call `assignSupertonicVoice()` instead of assigning VOICEVOX IDs.

### 3. App.jsx - Frontend changes

#### 3a. Add state & check function
```javascript
const [supertonicStatus, setSupertonicStatus] = useState('checking');
const [ttsEngine, setTtsEngine] = useState('auto'); // 'auto' | 'voicevox' | 'supertonic'

const checkSupertonic = async () => {
  setSupertonicStatus('checking');
  try {
    const res = await fetch('/api/supertonic/status');
    const data = await res.json();
    setSupertonicStatus(data.connected ? 'connected' : 'error');
  } catch {
    setSupertonicStatus('error');
  }
};
```

Add `checkSupertonic()` to the init `useEffect`.

#### 3b. Relax canProceed condition
```javascript
// Before:
const canProceed = voicevoxStatus === 'connected' && geminiKeyValid;

// After:
const canProceed = (voicevoxStatus === 'connected' || supertonicStatus === 'connected') && geminiKeyValid;
```

#### 3c. Add Supertonic status display in SETUP phase
Below the Edge-TTS status block (~line 440), add a similar block for Supertonic 3.

#### 3d. Add TTS engine selector in DROP phase
In the `status-badges` div (~line 473), add a dropdown/select for TTS engine choice:
```jsx
<select value={ttsEngine} onChange={(e) => setTtsEngine(e.target.value)}>
  <option value="auto">Auto (VOICEVOX priority)</option>
  <option value="voicevox" disabled={voicevoxStatus !== 'connected'}>VOICEVOX</option>
  <option value="supertonic" disabled={supertonicStatus !== 'connected'}>Supertonic 3</option>
</select>
```
Style this to match the existing dark UI theme.

#### 3e. Pass ttsEngine to generate API
In `startGeneration`, send the selected engine to the server. Currently the generate call is:
```javascript
const genRes = await fetch(`/api/generate/${sessionId}`, { method: 'POST', signal });
```
Change to:
```javascript
const genRes = await fetch(`/api/generate/${sessionId}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ ttsEngine }),
  signal
});
```

### 4. VoiceComic.tsx - Credit display

Line 204, change credit text to show which TTS was used:
```tsx
{data.ttsEngine === 'supertonic' ? "Sound: Supertonic 3" : data.isEnglish ? "Audio: Microsoft Edge-TTS" : "Sound: VOICEVOX"}
```

## Key Technical Details

### Supertonic 3 REST API Reference
```
Server: http://127.0.0.1:7789

GET  /v1/health     -> { status, model, sample_rate, version, voices_loaded }
GET  /v1/styles      -> list of available voices (M1-M5, F1-F5, custom)
POST /v1/tts         -> { text, voice, lang, speed?, total_steps? } -> WAV binary (44.1kHz)
POST /v1/tts/batch   -> batch synthesis (up to 64 items)
```

### Sample Supertonic TTS Request
```bash
curl -X POST http://127.0.0.1:7789/v1/tts \
  -H 'content-type: application/json' \
  -d '{"text":"This is a test <laugh>","voice":"M1","lang":"ja"}' \
  -o output.wav
```

### Expression Tags (10 types)
`<laugh>`, `<breath>`, `<sigh>`, and 7 others. Embed directly in text string.

### Critical: Sample Rate Mismatch
- VOICEVOX outputs 24kHz WAV -> Remotion uses this directly
- Supertonic 3 outputs 44.1kHz WAV -> MUST resample to 24kHz via ffmpeg
- ffmpeg path: `node_modules/@remotion/compositor-win32-x64-msvc/ffmpeg.exe` (already used by Edge-TTS)

### Install Command
```bash
pip install "supertonic[serve]"
supertonic serve --host 127.0.0.1 --port 7789
```

## Files to Modify
1. `start_ai-voice-comic-maker.bat` - Supertonic auto-install & startup
2. `server.js` - Status API, casting, synthesis, generate pipeline
3. `src/App.jsx` - Status check, engine selector UI, canProceed logic
4. `src/compositions/VoiceComic.tsx` - Credit display

## Files NOT to Modify
- `package.json` - No npm dependency needed (Supertonic is Python-side)
- `generate_bgm.js` - BGM is unrelated
- `src/index.css` - Unless adding styles for the TTS selector dropdown

## Project Rules Reminder
- **NO test files** - Verify by running `start_ai-voice-comic-maker.bat` and dropping a manga image
- **NO garbage files** - Clean up any temp scripts after use
- **UTF-8 everywhere** - All commands must start with `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8`
- **Batch files: ASCII only** - No Japanese text in .bat files
- **Version sync** - If version changes, sync all 5 locations (package.json, App.jsx, index.html, README.md, GitHub Release)
- **This is a LOCAL-ONLY app** - No `npm run deploy` to GitHub Pages
- Read `AGENTS.md` and `docs/deploy.md` before starting work

## Git Status
- Clean working tree (all previous changes committed as v1.8.4)
- Remote: `git@github.com:FURUYAN1234/ai-voice-comic-maker.git`
- Branch: `master`
