/**
 * AI Voice Comic Maker - メインアプリケーション
 * 
 * 正式仕様:
 * 漫画画像をドロップするだけ → Gemini Vision OCR で全自動解析
 * → VOICEVOX音声合成 → Remotion動画レンダリング
 * 
 * JSONは一切不要。全てAIが判断する。
 * 
 * 画面フロー:
 * ① 初期設定（APIキー入力 + VOICEVOX接続確認）
 * → ② 画像ドロップゾーン
 * → ③ AI解析 & 生成中
 * → ④ プレーヤー＆SNSシェア
 */
import React, { useState, useCallback, useEffect } from 'react';

const SYSTEM_VERSION = "1.2.9";

// タイトルを「」で囲むヘルパー（すでに囲まれていたら二重にしない）
const wrapKagi = (title) => {
  if (!title) return '';
  if (title.startsWith('「') && title.endsWith('」')) return title;
  return `「${title}」`;
};

// アプリの状態
const PHASE = {
  SETUP: 'setup',       // APIキー入力 + VOICEVOX接続確認
  DROP: 'drop',         // 画像ドロップ待ち
  GENERATING: 'generating', // AI解析 → 音声合成 → 動画生成
  COMPLETE: 'complete', // 完成 → プレーヤー＆ダウンロード
};

export default function App() {
  const [phase, setPhase] = useState(PHASE.SETUP);
  const [voicevoxStatus, setVoicevoxStatus] = useState('checking'); // checking | connected | error
  const [geminiKey, setGeminiKey] = useState('');
  const [geminiKeyValid, setGeminiKeyValid] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [progress, setProgress] = useState({ step: 0, total: 5, message: '' });
  const [videoUrl, setVideoUrl] = useState(null);
  const [videoTitle, setVideoTitle] = useState('');
  const [ocrPreview, setOcrPreview] = useState(null);
  const [error, setError] = useState(null);
  const [terminalLogs, setTerminalLogs] = useState([]);
  const [currentSessionId, setCurrentSessionId] = useState(null);
  const [isCopied, setIsCopied] = useState(false);
  const logEndRef = React.useRef(null);

  // ターミナルの自動スクロール
  useEffect(() => {
    if (logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [terminalLogs]);

  // ── リアルタイムバックエンドログのポーリング ──
  useEffect(() => {
    if (phase !== PHASE.GENERATING || !currentSessionId) {
      if (phase !== PHASE.GENERATING) setTerminalLogs([]);
      return;
    }
    
    let lastIndex = 0;
    let isActive = true;

    const fetchLogs = async () => {
      if (!isActive) return;
      try {
        const res = await fetch(`/api/logs/${currentSessionId}?sinceIndex=${lastIndex}`);
        if (res.ok) {
          const data = await res.json();
          if (data.logs && data.logs.length > 0) {
            lastIndex = data.nextIndex;
            setTerminalLogs(prev => {
              // 念のため重複排除
              const combined = [...prev, ...data.logs];
              return Array.from(new Set(combined));
            });
          }
        }
      } catch (err) {
        // ポーリングエラーは無視
      }
    };

    fetchLogs(); // 即時実行
    const interval = setInterval(fetchLogs, 1000);
    
    return () => {
      isActive = false;
      clearInterval(interval);
    };
  }, [phase, currentSessionId]);

  // ── 初期化 ──
  useEffect(() => {
    checkVoicevox();
    // サーバー側に保存済みのAPIキーがあるか確認
    checkSavedApiKey();
  }, []);

  const checkSavedApiKey = async () => {
    try {
      const res = await fetch('/api/gemini/status');
      const data = await res.json();
      if (data.configured) {
        setGeminiKeyValid(true);
      }
    } catch {
      // サーバー未起動時は無視
    }
  };

  // ── VOICEVOX 接続チェック ──
  const checkVoicevox = async () => {
    setVoicevoxStatus('checking');
    try {
      const res = await fetch('/api/voicevox/status');
      const data = await res.json();
      if (data.connected) {
        setVoicevoxStatus('connected');
      } else {
        setVoicevoxStatus('error');
      }
    } catch {
      setVoicevoxStatus('error');
    }
  };

  // ── APIキー設定 ──
  const handleSetApiKey = async () => {
    if (!geminiKey.trim()) return;
    try {
      const res = await fetch('/api/gemini/key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: geminiKey.trim() }),
      });
      const data = await res.json();
      if (data.valid) {
        setGeminiKeyValid(true);
        setError(null);
      } else {
        setError('APIキーが無効です。正しいキーを入力してください。');
      }
    } catch {
      setError('サーバーに接続できません。');
    }
  };

  // ── 両方OKならドロップフェーズに遷移 ──
  const canProceed = voicevoxStatus === 'connected' && geminiKeyValid;
  useEffect(() => {
    if (canProceed && phase === PHASE.SETUP) {
      setPhase(PHASE.DROP);
    }
  }, [canProceed, phase]);

  // ── ファイルドロップ処理（画像のみ！JSONは不要！） ──
  const handleDrop = useCallback((e) => {
    e.preventDefault();
    setDragOver(false);

    const droppedFiles = Array.from(e.dataTransfer.files);
    const imageFile = droppedFiles.find(f => /\.(png|jpg|jpeg|webp)$/i.test(f.name));

    if (imageFile) {
      startGeneration(imageFile);
    } else {
      setError('⚠️ 漫画画像 (.png/.jpg/.webp) をドロップしてください');
    }
  }, []);

  // ── ファイル選択ダイアログ（クリックでも選択可能） ──
  const handleFileSelect = useCallback((e) => {
    const file = e.target.files?.[0];
    if (file && /\.(png|jpg|jpeg|webp)$/i.test(file.name)) {
      startGeneration(file);
    }
  }, []);

  // ── 動画生成開始 ──
  const startGeneration = async (imageFile) => {
    setPhase(PHASE.GENERATING);
    setError(null);
    setOcrPreview(null);
    setVideoTitle(imageFile.name.replace(/\.[^.]+$/, ''));

    try {
      const formData = new FormData();
      formData.append('image', imageFile);

      // Step 1: 画像アップロード
      setProgress({ step: 1, total: 5, message: '画像をアップロード中...' });
      const uploadRes = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      });
      if (!uploadRes.ok) throw new Error('アップロードに失敗しました');
      const { sessionId } = await uploadRes.json();
      setCurrentSessionId(sessionId);

      // Step 2: Gemini OCR で AI解析
      setProgress({ step: 2, total: 5, message: 'AI が漫画を解析中... 🔍' });
      const ocrRes = await fetch(`/api/analyze/${sessionId}`, { method: 'POST' });
      if (!ocrRes.ok) {
        const errData = await ocrRes.json().catch(() => ({}));
        throw new Error(errData.error || 'AI解析に失敗しました');
      }
      const { metadata } = await ocrRes.json();
      setVideoTitle(metadata.title || imageFile.name.replace(/\.[^.]+$/, ''));
      setOcrPreview(metadata);

      // Step 3: VOICEVOX 音声合成
      setProgress({ step: 3, total: 5, message: 'VOICEVOX で音声合成中... 🎙️' });

      // Step 4: 動画レンダリング
      setProgress({ step: 4, total: 5, message: 'Remotion で動画レンダリング中... 🎬' });

      // Step 3-4 を一括実行
      const genRes = await fetch(`/api/generate/${sessionId}`, { method: 'POST' });
      if (!genRes.ok) {
        const errData = await genRes.json().catch(() => ({}));
        throw new Error(errData.error || '動画生成に失敗しました');
      }

      // Step 5: 完了
      setProgress({ step: 5, total: 5, message: '完了！ 🎉' });
      setVideoUrl(`/api/video/${sessionId}`);
      setPhase(PHASE.COMPLETE);

    } catch (err) {
      setError(err.message);
      setPhase(PHASE.DROP);
    }
  };

  // ── ダウンロード ──
  const handleDownload = () => {
    if (!videoUrl) return;
    const a = document.createElement('a');
    a.href = videoUrl;
    a.download = `voice_comic_${Date.now()}.mp4`;
    a.click();
  };

  // ── SNS共有 ──
  const shareToTwitter = () => {
    const text = `🎬 AIで漫画${wrapKagi(videoTitle)}のボイスコミックを作ったよ！\n#AIVoiceComicMaker #ボイスコミック`;
    window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`, '_blank');
  };

  const shareToLine = () => {
    const text = `AIで漫画${wrapKagi(videoTitle)}のボイスコミックを作ったよ！`;
    window.open(`https://line.me/R/msg/text/?${encodeURIComponent(text)}`, '_blank');
  };

  // ── タイトルコピー ──
  const handleCopyTitle = async () => {
    try {
      await navigator.clipboard.writeText(wrapKagi(videoTitle));
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy', err);
    }
  };

  // ── もう一度作る ──
  const handleReset = () => {
    setPhase(PHASE.DROP);
    setVideoUrl(null);
    setVideoTitle('');
    setOcrPreview(null);
    setProgress({ step: 0, total: 5, message: '' });
    setError(null);
  };

  return (
    <div className="app">
      {/* ヘッダー */}
      <header className="header">
        <h1 className="header-title">
          <span className="header-icon">🎬</span>
          AI Voice Comic Maker <span style={{ fontSize: '16px', color: '#9090b8', WebkitTextFillColor: 'initial', fontWeight: 'normal', marginLeft: '8px', verticalAlign: 'middle' }}>v{SYSTEM_VERSION}</span>
        </h1>
        <p className="header-subtitle">漫画画像をドロップするだけ。AIが全自動でボイスコミック動画を生成</p>
      </header>

      <main className="main">
        {/* ──────── Phase: SETUP (APIキー + VOICEVOX接続確認) ──────── */}
        {phase === PHASE.SETUP && (
          <div className="card setup-card">
            <div className="card-icon">⚙️</div>
            <h2>初期セットアップ</h2>

            {/* Gemini API Key 設定 */}
            <div className="setup-section">
              <div className="setup-item">
                <span className={`setup-status ${geminiKeyValid ? 'status-ok' : 'status-pending'}`}>
                  {geminiKeyValid ? '✅' : '🔑'}
                </span>
                <div className="setup-detail">
                  <strong>Gemini API Key</strong>
                  {geminiKeyValid ? (
                    <p className="setup-hint success">設定済み</p>
                  ) : (
                    <div className="api-key-form">
                      <p className="setup-hint">
                        漫画画像の解析に使用します。
                        <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer"> 取得はこちら →</a>
                      </p>
                      <div className="api-key-input-row">
                        <input
                          type="password"
                          className="api-key-input"
                          placeholder="AIza..."
                          value={geminiKey}
                          onChange={(e) => setGeminiKey(e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && handleSetApiKey()}
                        />
                        <button className="btn btn-set-key" onClick={handleSetApiKey}>設定</button>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* VOICEVOX 接続状態 */}
              <div className="setup-item">
                <span className={`setup-status ${voicevoxStatus === 'connected' ? 'status-ok' : voicevoxStatus === 'checking' ? 'status-pending' : 'status-error'}`}>
                  {voicevoxStatus === 'connected' ? '✅' : voicevoxStatus === 'checking' ? '⏳' : '❌'}
                </span>
                <div className="setup-detail">
                  <strong>VOICEVOX Engine</strong>
                  {voicevoxStatus === 'checking' && (
                    <p className="setup-hint">接続確認中...</p>
                  )}
                  {voicevoxStatus === 'connected' && (
                    <p className="setup-hint success">接続OK</p>
                  )}
                  {voicevoxStatus === 'error' && (
                    <div>
                      <p className="setup-hint error">
                        接続できません。VOICEVOXがインストールされているのに繋がらない場合は、VOICEVOXアプリを直接起動してみてください。
                      </p>
                      <button className="btn btn-retry" onClick={checkVoicevox}>🔄 再接続</button>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {error && (
              <div className="error-banner">{error}</div>
            )}
          </div>
        )}

        {/* ──────── Phase: DROP (画像ドロップ) ──────── */}
        {phase === PHASE.DROP && (
          <div className="card drop-card">
            <div className="status-badges">
              <div className="voicevox-badge">
                <span className="badge-dot" />
                VOICEVOX 接続中
              </div>
              <div className="gemini-badge">
                <span className="badge-dot badge-dot--gemini" />
                Gemini AI 準備完了
              </div>
            </div>

            <div
              className={`drop-zone ${dragOver ? 'drop-zone--active' : ''}`}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              onClick={() => document.getElementById('file-input')?.click()}
            >
              <input
                id="file-input"
                type="file"
                accept=".png,.jpg,.jpeg,.webp"
                style={{ display: 'none' }}
                onChange={handleFileSelect}
              />
              <div className="drop-zone-content">
                <div className="drop-icon">{dragOver ? '📥' : '🖼️'}</div>
                <h2 className="drop-title">
                  {dragOver ? 'ここにドロップ！' : '漫画画像をドロップ'}
                </h2>
                <p className="drop-desc">
                  4コマ漫画の画像をドラッグ＆ドロップ
                  <br />
                  <strong>AIがセリフ・話者・感情を全自動で解析します</strong>
                </p>
                <div className="drop-formats">
                  <span className="format-tag">PNG</span>
                  <span className="format-tag">JPG</span>
                  <span className="format-tag">WebP</span>
                </div>
                <p className="drop-click-hint">クリックでファイル選択も可</p>
              </div>
            </div>

            {error && (
              <div className="error-banner">{error}</div>
            )}
          </div>
        )}

        {/* ──────── Phase: GENERATING (AI解析 → 生成中) ──────── */}
        {phase === PHASE.GENERATING && (
          <div className="card generating-card">
            <div className="card-icon generating-icon">🎬</div>
            <h2>ボイスコミック生成中...</h2>
            {videoTitle && <p className="generating-title">{wrapKagi(videoTitle)}</p>}

            <div className="progress-container">
              <div className="progress-bar">
                <div
                  className="progress-fill"
                  style={{ width: `${(progress.step / progress.total) * 100}%` }}
                />
              </div>
              <div className="progress-steps">
                {['アップロード', 'AI 解析', '音声合成', '動画生成', '完了'].map((label, i) => (
                  <div
                    key={i}
                    className={`progress-step ${progress.step > i + 1 ? 'step-done' : ''} ${progress.step === i + 1 ? 'step-active' : ''}`}
                  >
                    <div className="step-dot">
                      {progress.step > i + 1 ? '✓' : i + 1}
                    </div>
                    <span className="step-label">{label}</span>
                  </div>
                ))}
              </div>
            </div>

            <p className="progress-message">{progress.message}</p>

            {/* ターミナル風ログ小窓 */}
            <div className="terminal-log" style={{
              backgroundColor: "#0f172a",
              color: "#38bdf8",
              fontFamily: "monospace",
              fontSize: "12px",
              padding: "16px",
              borderRadius: "8px",
              marginTop: "20px",
              height: "150px",
              overflowY: "auto",
              textAlign: "left",
              boxShadow: "inset 0 0 10px rgba(0,0,0,0.5)"
            }}>
              {terminalLogs.map((log, i) => (
                <div key={i} style={{ marginBottom: "4px", opacity: i === terminalLogs.length - 1 ? 1 : 0.7 }}>
                  {log}
                </div>
              ))}
              <div ref={logEndRef} style={{ animation: "blink 1s step-end infinite" }}>_</div>
            </div>

            {/* OCR結果のプレビュー */}
            {ocrPreview && (
              <div className="ocr-preview">
                <h3>🔍 AI解析結果</h3>
                <div className="ocr-details">
                  <p><strong>タイトル:</strong> {wrapKagi(ocrPreview.title)}</p>
                  <p><strong>コマ数:</strong> {ocrPreview.panels.length}</p>
                  <p><strong>セリフ数:</strong> {ocrPreview.panels.reduce((s, p) => s + (p.dialogues ? p.dialogues.length : 0), 0)}</p>
                </div>
                
                {/* 話者とキャスティングのプレビュー */}
                <div className="cast-preview" style={{ marginTop: '16px', padding: '12px', background: '#1e293b', borderRadius: '8px', borderLeft: '4px solid #38bdf8' }}>
                  <h4 style={{ color: '#38bdf8', marginBottom: '8px', fontSize: '14px' }}>🎭 話者とキャスティング（AI自動配役）</h4>
                  <ul style={{ listStyle: 'none', padding: 0, margin: 0, fontSize: '13px' }}>
                    {Array.from(new Set(
                      ocrPreview.panels.flatMap(p => (p.dialogues || []).map(d => JSON.stringify({ name: d.speaker, voice: d.voiceId, gender: d.gender })))
                    )).map((str, i) => {
                      const c = JSON.parse(str);
                      const voiceNames = { 8: "春日部つむぎ", 16: "九州そら", 2: "四国めたん", 14: "冥鳴ひまり", 10: "雨晴はう", 12: "白上虎太郎", 13: "青山龍星", 11: "玄野武宏" };
                      return (
                        <li key={i} style={{ marginBottom: '4px' }}>
                          ・<strong>{c.name}</strong> <span style={{ color: '#94a3b8' }}>({c.gender === 'female' ? '女性' : c.gender === 'male' ? '男性' : '不明'})</span> ➔ {voiceNames[c.voice] || `VOICEVOX_ID:${c.voice}`}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              </div>
            )}

            {error && (
              <div className="error-banner">
                {error}
                <button className="btn btn-retry" onClick={handleReset}>やり直す</button>
              </div>
            )}
          </div>
        )}

        {/* ──────── Phase: COMPLETE (完成) ──────── */}
        {phase === PHASE.COMPLETE && (
          <div className="card complete-card">
            <h2 className="complete-title">🎉 ボイスコミック完成！</h2>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', marginBottom: '16px' }}>
              <p className="complete-subtitle" style={{ margin: 0 }}>{wrapKagi(videoTitle)}</p>
              <button 
                className={`btn-copy-title ${isCopied ? 'btn-copy-title--copied' : ''}`}
                onClick={handleCopyTitle}
                title="タイトルをコピー"
              >
                <span className="copy-icon">{isCopied ? '✓' : '📋'}</span>
                {isCopied ? 'コピー完了' : 'タイトルをコピー'}
              </button>
            </div>

            {/* 内蔵プレーヤー */}
            <div className="player-container">
              <video
                className="video-player"
                src={videoUrl}
                controls
                autoPlay
                playsInline
              />
            </div>

            {/* アクションボタン */}
            <div className="action-buttons">
              <button className="btn btn-download" onClick={handleDownload}>
                📥 ダウンロード
              </button>

              <button className="btn btn-reset" onClick={handleReset}>
                🔄 もう一つ作る
              </button>
            </div>
          </div>
        )}
      </main>

      {/* フッター */}
      <footer className="footer">
        <p>AI Voice Comic Maker v{SYSTEM_VERSION} — 画像ドロップだけで全自動ボイスコミック生成</p>
      </footer>
    </div>
  );
}
