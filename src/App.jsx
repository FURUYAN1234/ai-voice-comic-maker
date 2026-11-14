import { localApiFetch } from './local-api.js';
import { modelStatusFromLogs } from './model-status.js';
/**
 * AI Voice Comic Maker - メインアプリケーション
 * 
 * 正式仕様:
 * 漫画画像をドロップするだけ → Gemini/OpenAI Vision OCR で全自動解析
 * → VOICEVOX / Supertonic 3 / Edge-TTS 音声合成 → Remotion動画レンダリング
 * 
 * JSONは一切不要。全てAIが判断する。
 * 
 * 画面フロー:
 * ① 初期設定（APIキー入力 + ローカルTTS接続確認）
 * → ② 画像ドロップゾーン
 * → ③ AI解析 & 生成中
 * → ④ プレーヤー＆SNSシェア
 */
import { OPENAI_MODEL_OPTIONS, OPENAI_MODEL_PRICE_SNAPSHOT_DATE, OPENAI_PRONUNCIATION_MODEL, DEFAULT_OPENAI_MODEL, fallbackModels } from '../openai-chat-contract.js';
import React, { useState, useEffect } from 'react';

const SYSTEM_VERSION = '1.9.6';
const DEBUG_MODE = false;

// タイトルを「」で囲むヘルパー（すでに囲まれていたら二重にしない）
const wrapKagi = (title) => {
  if (!title) return '';
  if (title.startsWith('「') && title.endsWith('」')) return title;
  return `「${title}」`;
};

const getTtsEngineLabel = (engine) => {
  switch (engine) {
    case 'supertonic':
      return 'Supertonic 3';
    case 'voicevox':
      return 'VOICEVOX';
    default:
      return 'Auto';
  }
};

// アプリの状態
const PHASE = {
  SETUP: 'setup',       // APIキー入力 + VOICEVOX接続確認
  DROP: 'drop',         // 画像ドロップ待ち
  GENERATING: 'generating', // AI解析 → 音声合成 → 動画生成
  CANCELLING: 'cancelling', // 中断処理中
  COMPLETE: 'complete', // 完成 → プレーヤー＆ダウンロード
};

export default function App() {
  const [phase, setPhase] = useState(PHASE.SETUP);
  const [voicevoxStatus, setVoicevoxStatus] = useState('checking'); // checking | connected | error
  const [edgettsStatus, setEdgettsStatus] = useState('checking'); // checking | connected | error
  const [supertonicStatus, setSupertonicStatus] = useState('checking'); // checking | connected | error
  const [ttsEngine, setTtsEngine] = useState('auto'); // auto | voicevox | supertonic
  const [geminiKey, setGeminiKey] = useState('');
  const [geminiKeyValid, setGeminiKeyValid] = useState(false);
  const [apiChecking,setApiChecking]=useState(false);
  const [openaiModel, setOpenaiModel] = useState(DEFAULT_OPENAI_MODEL);
  const [modelStatus, setModelStatus] = useState(null);
  const [selectedImage, setSelectedImage] = useState(null);
  const [activeEngine, setActiveEngine] = useState('gemini');
  const [dragOver, setDragOver] = useState(false);
  const [progress, setProgress] = useState({ step: 0, total: 5, message: '' });
  const [videoUrl, setVideoUrl] = useState(null);
  const [videoFilename, setVideoFilename] = useState(''); // サーバーから返されるファイル名
  const [videoTitle, setVideoTitle] = useState('');
  const [ocrPreview, setOcrPreview] = useState(null);
  const [error, setError] = useState(null);
  const [terminalLogs, setTerminalLogs] = useState([]);
  const [currentSessionId, setCurrentSessionId] = useState(null);
  const [isCopied, setIsCopied] = useState(false);
  const logEndRef = React.useRef(null);
  const abortControllerRef = React.useRef(null);
  const sessionIdRef=React.useRef(null);
  const ttsEngineRef = React.useRef('auto');

  // ターミナルの自動スクロール
  useEffect(() => {
    if (logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [terminalLogs]);

  useEffect(() => {
    ttsEngineRef.current = ttsEngine;
  }, [ttsEngine]);

  useEffect(() => {
    if (ttsEngine === 'voicevox' && voicevoxStatus !== 'connected') setTtsEngine('auto');
    if (ttsEngine === 'supertonic' && supertonicStatus !== 'connected') setTtsEngine('auto');
  }, [ttsEngine, voicevoxStatus, supertonicStatus]);

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
        const res = await localApiFetch(`/api/logs/${currentSessionId}?sinceIndex=${lastIndex}`);
        if (res.ok) {
          const data = await res.json();
          if (!isActive) return;
          setModelStatus(previous => data.modelStatus || modelStatusFromLogs(previous, data.logs));
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
    checkEdgeTts();
    checkSupertonic();
    // サーバー側に保存済みのAPIキーがあるか確認
    checkSavedApiKey();
  }, []);

  const checkSavedApiKey = async () => {
    try {
      const res = await localApiFetch('/api/apistatus');
      const data = await res.json();
      if (data.configured) {
        setGeminiKeyValid(true);
        setActiveEngine(data.engine || 'gemini');
      }
    } catch {
      // サーバー未起動時は無視
    }
  };

  // ── VOICEVOX 接続チェック ──
  const checkVoicevox = async () => {
    setVoicevoxStatus('checking');
    try {
      const res = await localApiFetch('/api/voicevox/status');
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

  // ── Edge-TTS 接続チェック ──
  const checkEdgeTts = async () => {
    setEdgettsStatus('checking');
    try {
      const res = await localApiFetch('/api/edgetts/status');
      const data = await res.json();
      if (data.connected) {
        setEdgettsStatus('connected');
      } else {
        setEdgettsStatus('error');
      }
    } catch {
      setEdgettsStatus('error');
    }
  };

  // ── APIキー設定 ──
  const checkSupertonic = async () => {
    setSupertonicStatus('checking');
    try {
      const res = await localApiFetch('/api/supertonic/status');
      const data = await res.json();
      setSupertonicStatus(data.connected ? 'connected' : 'error');
    } catch {
      setSupertonicStatus('error');
    }
  };

  useEffect(() => {
    if (supertonicStatus === 'connected') return;
    if (phase !== PHASE.SETUP && phase !== PHASE.DROP) return;
    const timer = setInterval(checkSupertonic, 3000);
    return () => clearInterval(timer);
  }, [phase, supertonicStatus]);

  const handleSetApiKey = async () => {
    if (!geminiKey.trim() || apiChecking || abortControllerRef.current) return;
    const controller=new AbortController();abortControllerRef.current=controller;setApiChecking(true);
    try {
      const res = await localApiFetch('/api/apikey', {
        signal:controller.signal,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: geminiKey.trim(), openaiModel }),
      });
      const data = await res.json();
      controller.signal.throwIfAborted();
      if (data.valid) {
        setGeminiKeyValid(true);
        setActiveEngine(data.engine || 'gemini');
        setError(null);
      } else {
        setError('APIキーが無効です。正しいキーを入力してください。');
      }
    } catch(error) {
      if(!controller.signal.aborted)setError('サーバーに接続できません。');
    } finally {if(abortControllerRef.current===controller){abortControllerRef.current=null;setApiChecking(false);}}
  };

  // ── 両方OKならドロップフェーズに遷移 ──
  const canProceed = (voicevoxStatus === 'connected' || supertonicStatus === 'connected') && geminiKeyValid;
  useEffect(() => {
    if (canProceed && phase === PHASE.SETUP) {
      setPhase(PHASE.DROP);
    }
  }, [canProceed, phase]);

  // ── ファイルドロップ処理（画像のみ！JSONは不要！） ──
  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);

    const droppedFiles = Array.from(e.dataTransfer.files);
    const imageFile = droppedFiles.find(f => /\.(png|jpg|jpeg|webp)$/i.test(f.name));

    if (imageFile) {
      startGeneration(imageFile);
    } else {
      setError('⚠️ 漫画画像 (.png/.jpg/.webp) をドロップしてください');
    }
  };

  // ── ファイル選択ダイアログ（クリックでも選択可能） ──
  const handleFileSelect = (e) => {
    const file = e.target.files?.[0];
    if (file && /\.(png|jpg|jpeg|webp)$/i.test(file.name)) {
      startGeneration(file);
    }
  };

  // ── 動画生成開始 ──
  const startGeneration = async (imageFile) => {
    if(abortControllerRef.current)return;
    if (imageFile.size > 20 * 1024 * 1024) {
      setError('画像は20 MiB以下にしてください');
      return;
    }
    setSelectedImage(imageFile);
    const selectedOpenAIModel = openaiModel;
    setModelStatus(null);
    setPhase(PHASE.GENERATING);
    setError(null);
    setOcrPreview(null);
    setTerminalLogs([]);
    setCurrentSessionId(null);sessionIdRef.current=null;
    setVideoTitle(imageFile.name.replace(/\.[^.]+$/, ''));
    const selectedTtsEngine = ttsEngineRef.current;

    const controller = new AbortController();
    abortControllerRef.current = controller;
    const signal = controller.signal;
    try {

      const formData = new FormData();
      formData.append('image', imageFile);

      // Step 1: 画像アップロード
      setProgress({ step: 1, total: 5, message: '画像をアップロード中...' });
      const uploadRes = await localApiFetch('/api/upload', {
        method: 'POST',
        body: formData,
        signal
      });
      if (!uploadRes.ok) throw new Error(uploadRes.status === 413
        ? '画像は20 MiB以下・1ファイルのみアップロードできます'
        : 'アップロードに失敗しました');
      const { sessionId } = await uploadRes.json();
      signal.throwIfAborted();
      sessionIdRef.current=sessionId;
      setCurrentSessionId(sessionId);

      // Step 2: Gemini OCR で AI解析
      setProgress({ step: 2, total: 5, message: 'AI が漫画を解析中... 🔍' });
      const ocrRes = await localApiFetch(`/api/analyze/${sessionId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ttsEngine: selectedTtsEngine, openaiModel: selectedOpenAIModel }),
        signal
      });
      signal.throwIfAborted();
      if (!ocrRes.ok) {
        const errData = await ocrRes.json().catch(() => ({}));
        signal.throwIfAborted();
        setModelStatus(errData.modelStatus || null);
        throw new Error(errData.error || 'AI解析に失敗しました');
      }
      const { metadata, modelStatus: resultModelStatus } = await ocrRes.json();
      signal.throwIfAborted();
      setModelStatus(resultModelStatus);
      setVideoTitle(metadata.title || imageFile.name.replace(/\.[^.]+$/, ''));
      setOcrPreview(metadata);

      // Step 3: 音声合成
      setProgress({ step: 3, total: 5, message: `${getTtsEngineLabel(selectedTtsEngine)} で音声合成中... 🎙️` });

      // Step 4: 動画レンダリング
      setProgress({ step: 4, total: 5, message: 'Remotion で動画レンダリング中... 🎬' });

      // Step 3-4 を一括実行
      const genRes = await localApiFetch(`/api/generate/${sessionId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ttsEngine: selectedTtsEngine }),
        signal
      });
      signal.throwIfAborted();
      if (!genRes.ok) {
        const errData = await genRes.json().catch(() => ({}));
        throw new Error(errData.error || '動画生成に失敗しました');
      }

      // Step 5: 完了
      // サーバーから返された正しいファイル名を保持（voice_comic_JP/EN_タイトル名_YYYYMMDDHHmmss.mp4）
      const genData = await genRes.json();
      signal.throwIfAborted();
      setProgress({ step: 5, total: 5, message: '完了！ 🎉' });
      setVideoUrl(`/api/video/${sessionId}`);
      if (genData.videoFilename) {
        setVideoFilename(genData.videoFilename);
      }
      setPhase(PHASE.COMPLETE);

    } catch (err) {
      if (signal.aborted || err.name === 'AbortError' || err.message === 'CanceledByUser') {
        console.log('Generation cancelled by user.');
        // 中断時は handleCancel 側で状態遷移を管理するためここでは何もしない
      } else {
        setError(err.message);
        setPhase(PHASE.DROP);
      }
    } finally {if(abortControllerRef.current===controller)abortControllerRef.current=null;}
  };

  // ── 生成中断 ──
  const handleCancel = async () => {
    const controller=abortControllerRef.current;
    if(phase !== PHASE.CANCELLING && (!controller || controller.signal.aborted))return;
    controller?.abort();
    if(apiChecking){setApiChecking(false);setError('API接続確認を中断しました。入力したキーは保持しています。');return;}
    setPhase(PHASE.CANCELLING);
    setError(null);
    try {
      if(sessionIdRef.current){
        const response=await localApiFetch(`/api/cancel/${sessionIdRef.current}`,{method:'DELETE'});
        if(!response.ok)throw new Error('Cancellation confirmation failed');
      }
      setPhase(PHASE.DROP);
      setProgress({step:0,total:5,message:'生成を中断しました。'});
      setError(null);
    } catch(error){setError('中断の確認に失敗しました。バックエンドの状態を確認してから再実行してください。');}
  };

  // ── ダウンロード ──
  const handleDownload = () => {
    if (!videoUrl) return;
    const a = document.createElement('a');
    a.href = videoUrl;
    // サーバーから返された正しいファイル名を使用（voice_comic_JP/EN_タイトル名_YYYYMMDDHHmmss.mp4）
    a.download = videoFilename || `voice_comic_${new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14)}.mp4`;
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
    setVideoFilename('');
    setVideoTitle('');
    setSelectedImage(null);
    setOcrPreview(null);
    setProgress({ step: 0, total: 5, message: '' });
    setError(null);
  };

  return (
    <div className={`app${geminiKeyValid || apiChecking || phase !== PHASE.SETUP ? ' emergency-stop-ready' : ''}`}>
      {/* ヘッダー */}
      <header className="header">
        <h1 className="header-title">
          <span className="header-icon">🎬</span>
          AI Voice Comic Maker <span style={{ fontSize: '16px', color: '#9090b8', WebkitTextFillColor: 'initial', fontWeight: 'normal', marginLeft: '8px', verticalAlign: 'middle' }}>v{SYSTEM_VERSION}</span>
        </h1>
        <p className="header-subtitle">漫画画像をドロップするだけ。AIが全自動でボイスコミック動画を生成</p>
        <nav className="manual-links" aria-label="PDFガイド"><a href={`${import.meta.env.BASE_URL}downloads/short-movie-manual.pdf`} target="_blank" rel="noopener noreferrer">操作マニュアル（PDF）</a><a href={`${import.meta.env.BASE_URL}downloads/short-movie-api-guide.pdf`} target="_blank" rel="noopener noreferrer">API設定ガイド（PDF）</a></nav><p className="manual-help">別タブで開き、PDFビューアーから保存できます。</p>
        {(geminiKeyValid || apiChecking || phase !== PHASE.SETUP) && <div className="emergency-controls"><button id="emergency-stop" aria-label="緊急停止：通信・生成を中断" title="通信と生成を中断します。API提供元での処理・課金停止は保証しません。" type="button" className="btn btn-emergency-stop" onClick={handleCancel} disabled={!apiChecking && phase !== PHASE.GENERATING}>⏹ 緊急停止</button><p className="manual-help">API接続確認・AI解析・音声・動画処理中だけ有効です。API側の処理・課金停止は保証しません。</p></div>}
      </header>
      {(activeEngine === 'openai' || geminiKey.trim().startsWith('sk-')) && <div className="card openai-model-card">
        <label htmlFor="openai-model">解析・校正モデル <span>OPENAI</span></label>
        <select id="openai-model" value={openaiModel} onChange={event => { fallbackModels(event.target.value); setOpenaiModel(event.target.value); setModelStatus(null); }} disabled={apiChecking || phase === PHASE.GENERATING || phase === PHASE.CANCELLING}>
          {OPENAI_MODEL_OPTIONS.map(model => <option key={model.id} value={model.id}>{model.label}</option>)}
        </select>
        <small className="openai-model-help">{OPENAI_MODEL_OPTIONS.find(model => model.id === openaiModel)?.description}<br/>入力 ${OPENAI_MODEL_OPTIONS.find(model => model.id === openaiModel)?.inputPriceUsdPerM} / 出力 ${OPENAI_MODEL_OPTIONS.find(model => model.id === openaiModel)?.outputPriceUsdPerM} per 1M tokens</small>
        <p className="openai-model-help">選択: {openaiModel} / 試行: {modelStatus?.attempted?.join(' → ') || 'なし'} / 採用: {modelStatus?.adopted || '未採用'}</p>
        {modelStatus && <p className="openai-model-help">校正の試行: {modelStatus.correctionAttempted?.join(' → ') || 'なし'} / 採用: {modelStatus.correctionAdopted || '未採用'}</p>}
        <details className="openai-model-help"><summary>Model Chain / 料金</summary><p>画像解析・校正: {fallbackModels(openaiModel).join(' → ')}</p><p>未知の英単語の発音補助: {OPENAI_PRONUNCIATION_MODEL}（単一モデル）。失敗時は辞書のみで続行し、処理ログに表示します。</p><p>入力/出力 USD per 1M tokens。推論トークン・校正回数で総額は変わります。価格確認日: {OPENAI_MODEL_PRICE_SNAPSHOT_DATE}。</p></details>
      </div>}


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
                  <strong>AI API Key</strong>
                  {geminiKeyValid ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginTop: '4px' }}>
                      <p className="setup-hint success" style={{ margin: 0 }}>設定済み ({activeEngine === 'openai' ? 'OpenAI' : 'Gemini (推奨/高精度)'})</p>
                      <button className="btn-change-key" onClick={() => { setGeminiKey(''); setGeminiKeyValid(false); }}>🔄 API切替（Gemini / OpenAI）</button>
                    </div>
                  ) : (
                    <div className="api-key-form">
                      <p className="setup-hint">
                        漫画画像の解析に使用します。<br/>

                        <strong>Gemini</strong> または <strong>OpenAI (sk-...)</strong> のAPIキーを入力すると自動で認識します。<br/>
                        <span style={{ fontSize: '12px', color: 'var(--accent-pink)' }}>※ OpenAI APIは、Geminiと比べて日本語テキストの誤認識が発生する場合があります。</span><br/>
                        <span style={{ marginTop: '8px', display: 'inline-block' }}>
                          <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer">Geminiキー取得</a>
                          <span style={{ margin: '0 8px', color: 'var(--text-muted)' }}>|</span>
                          <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener noreferrer">OpenAIキー取得</a>
                        </span>
                      </p>
                      <form
                        className="api-key-input-row"
                        onSubmit={(e) => {
                          e.preventDefault();
                          handleSetApiKey();
                        }}
                      >
                        <input
                          type="password"
                          className="api-key-input"
                          placeholder="AIza... または sk-..."
                          value={geminiKey}
                          onChange={(e) => setGeminiKey(e.target.value)}
                          autoComplete="off"
                        />
                        <button className="btn btn-set-key" type="submit" disabled={apiChecking}>{apiChecking?"接続確認中…":"設定"}</button>
                      </form>
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
                  <strong>VOICEVOX Engine (日本語音声用)</strong>
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

              {/* Edge-TTS 接続状態 */}
              <div className="setup-item" style={{ marginTop: '16px' }}>
                <span className={`setup-status ${edgettsStatus === 'connected' ? 'status-ok' : edgettsStatus === 'checking' ? 'status-pending' : 'status-error'}`}>
                  {edgettsStatus === 'connected' ? '✅' : edgettsStatus === 'checking' ? '⏳' : '❌'}
                </span>
                <div className="setup-detail">
                  <strong>Edge-TTS Engine (英語音声用)</strong>
                  {edgettsStatus === 'checking' && (
                    <p className="setup-hint">接続確認中...</p>
                  )}
                  {edgettsStatus === 'connected' && (
                    <p className="setup-hint success">接続OK (クラウドサービス疎通完了)</p>
                  )}
                  {edgettsStatus === 'error' && (
                    <div>
                      <p className="setup-hint error">
                        Microsoft Edge-TTS サーバーへの疎通に失敗しました。インターネット接続環境を確認してください。
                      </p>
                      <button className="btn btn-retry" onClick={checkEdgeTts}>🔄 再接続</button>
                    </div>
                  )}
                </div>
              </div>

              <div className="setup-item" style={{ marginTop: '16px' }}>
                <span className={`setup-status ${supertonicStatus === 'connected' ? 'status-ok' : supertonicStatus === 'checking' ? 'status-pending' : 'status-error'}`}>
                  {supertonicStatus === 'connected' ? 'OK' : supertonicStatus === 'checking' ? '...' : 'NG'}
                </span>
                <div className="setup-detail">
                  <strong>Supertonic 3 Engine (local TTS fallback)</strong>
                  {supertonicStatus === 'checking' && (
                    <p className="setup-hint">Checking local Supertonic 3 server...</p>
                  )}
                  {supertonicStatus === 'connected' && (
                    <p className="setup-hint success">Connected on localhost:7789</p>
                  )}
                  {supertonicStatus === 'error' && (
                    <div>
                      <p className="setup-hint error">Not connected. Use the launcher to start Supertonic 3, or continue with VOICEVOX if available.</p>
                      <button className="btn btn-retry" onClick={checkSupertonic}>Retry</button>
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
              <div className="voicevox-badge" style={ttsEngine === 'supertonic' ? { backgroundColor: 'rgba(168, 85, 247, 0.12)', color: '#c084fc', borderColor: 'rgba(168, 85, 247, 0.35)' } : undefined}>
                <span className="badge-dot" style={ttsEngine === 'supertonic' ? { backgroundColor: '#a855f7', boxShadow: '0 0 8px #a855f7' } : undefined} />
                TTS: {getTtsEngineLabel(ttsEngine)}
              </div>
              <div className="gemini-badge">
                <span className={`badge-dot ${activeEngine === 'openai' ? 'badge-dot--openai' : 'badge-dot--gemini'}`} style={activeEngine === 'openai' ? { backgroundColor: '#10a37f', boxShadow: '0 0 8px #10a37f' } : {}} />
                {activeEngine === 'openai' ? 'OpenAI 準備完了' : 'Gemini AI 準備完了'}
              </div>
              <button 
                className="btn-change-key" 
                onClick={() => {
                  setGeminiKey('');
                  setGeminiKeyValid(false);
                  setPhase(PHASE.SETUP);
                }}
                style={{ height: '32px', display: 'flex', alignItems: 'center', alignSelf: 'center' }}
                title="APIキーを変更する"
              >
                🔄 API切替（Gemini / OpenAI）
              </button>
              <select
                value={ttsEngine}
                onChange={(e) => setTtsEngine(e.target.value)}
                title="TTS Engine"
                style={{
                  height: '32px',
                  alignSelf: 'center',
                  borderRadius: '8px',
                  border: '1px solid rgba(56, 189, 248, 0.35)',
                  background: '#0f172a',
                  color: '#e2e8f0',
                  padding: '0 10px',
                  fontSize: '13px',
                }}
              >
                <option value="auto">Auto (VOICEVOX priority)</option>
                <option value="voicevox" disabled={voicevoxStatus !== 'connected'}>VOICEVOX</option>
                <option value="supertonic" disabled={supertonicStatus !== 'connected'}>Supertonic 3</option>
              </select>
            </div>

            {selectedImage && <div className="card"><p>保持中の画像: {selectedImage.name}</p><button type="button" className="btn" onClick={() => startGeneration(selectedImage)}>この画像で再実行</button></div>}
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
            
            {/* 生成中もステータスバッジを表示 */}
            <div className="status-badges" style={{ marginBottom: '16px' }}>
              <div className="voicevox-badge" style={ttsEngine === 'supertonic' ? { backgroundColor: 'rgba(168, 85, 247, 0.12)', color: '#c084fc', borderColor: 'rgba(168, 85, 247, 0.35)' } : undefined}>
                <span className="badge-dot" style={ttsEngine === 'supertonic' ? { backgroundColor: '#a855f7', boxShadow: '0 0 8px #a855f7' } : undefined} />
                TTS: {getTtsEngineLabel(ttsEngine)}
              </div>
              <div className="gemini-badge">
                <span className={`badge-dot ${activeEngine === 'openai' ? 'badge-dot--openai' : 'badge-dot--gemini'}`} style={activeEngine === 'openai' ? { backgroundColor: '#10a37f', boxShadow: '0 0 8px #10a37f' } : {}} />
                {activeEngine === 'openai' ? 'OpenAI 稼働中' : 'Gemini AI 稼働中'}
              </div>
            </div>

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
                      ocrPreview.panels.flatMap(p => (p.dialogues || []).map(d => JSON.stringify({
                        name: d.speaker,
                        voice: ttsEngine === 'supertonic' ? d.supertonicVoiceId : d.voiceId,
                        gender: d.gender
                      })))
                    )).map((str, i) => {
                      const c = JSON.parse(str);
                      const voiceNames = { 
                        2: "四国めたん", 
                        3: "ずんだもん", 
                        8: "春日部つむぎ", 
                        9: "波音リツ", 
                        10: "雨晴はう", 
                        11: "玄野武宏", 
                        12: "白上虎太郎", 
                        13: "青山龍星", 
                        14: "冥鳴ひまり", 
                        16: "九州そら" 
                      };
                      const isNumberId = typeof c.voice === 'number' || (c.voice !== null && c.voice !== undefined && !isNaN(Number(c.voice)));
                      const displayVoice = ttsEngine === 'supertonic'
                        ? (c.voice ? `Supertonic ${c.voice}` : 'Supertonic未割当')
                        : (isNumberId ? (voiceNames[c.voice] || `VOICEVOX_ID:${c.voice}`) : c.voice);
                      return (
                        <li key={i} style={{ marginBottom: '4px' }}>
                          ・<strong>{c.name}</strong> <span style={{ color: '#94a3b8' }}>({c.gender === 'female' ? '女性' : c.gender === 'male' ? '男性' : '不明'})</span> ➔ {displayVoice}
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

        {/* ──────── Phase: CANCELLING (中断処理中) ──────── */}
        {phase === PHASE.CANCELLING && (
          <div className="card generating-card" style={{ textAlign: 'center', padding: '60px 20px' }}>
            {error && <div className="error-banner" role="alert">{error}<button type="button" className="btn btn-retry" onClick={handleCancel}>停止状態を再確認</button></div>}
            <div className="card-icon" style={{ fontSize: '48px', marginBottom: '16px' }}>🛑</div>
            <h2 style={{ color: '#fca5a5' }}>生成を中断しました</h2>
            <p style={{ color: '#94a3b8', marginTop: '16px', lineHeight: '1.6', fontSize: '15px' }}>
              バックエンドの処理を停止し、<br/>
              サーバー上の一時ファイル（ゴミ動画や音声等）をクリーンアップしました。
            </p>
            <div style={{ marginTop: '24px' }}>
              <span style={{ display: 'inline-block', width: '24px', height: '24px', border: '3px solid rgba(56, 189, 248, 0.3)', borderTopColor: '#38bdf8', borderRadius: '50%', animation: 'spin 1s linear infinite' }}></span>
              <p style={{ color: '#64748b', fontSize: '13px', marginTop: '12px' }}>ドロップ画面へ戻ります...</p>
            </div>
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
                playsInline
                preload="auto"
                onLoadedMetadata={(e) => {
                  e.currentTarget.muted = false;
                  e.currentTarget.volume = 1;
                }}
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
