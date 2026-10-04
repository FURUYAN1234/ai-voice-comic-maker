import { parentPort, workerData } from 'node:worker_threads';
import { restrictRenderListeners } from './render-loopback.js';

restrictRenderListeners(address => parentPort.postMessage({ type: 'listener', address }));
// Dynamic import is essential: restrict listeners before evaluating Remotion.
const { renderMedia, selectComposition, makeCancelSignal } = await import('@remotion/renderer');
const { cancel, cancelSignal } = makeCancelSignal();
let cancelled = false;
let continueRendering;
parentPort.on('message', message => {
  if (message.type === 'cancel') { cancelled = true; cancel(); continueRendering?.(false); }
  if (message.type === 'continue') continueRendering?.(true);
});

try {
  const { bundledPath, compositionId, scriptData, outputPath, browserExecutable } = workerData;
  const composition = await selectComposition({
    serveUrl: bundledPath, id: compositionId, inputProps: { scriptData }, browserExecutable,
  });
  if (cancelled) throw new Error('CanceledByUser');
  composition.durationInFrames = scriptData.totalDurationInFrames;
  // Let the owner acknowledge the selected composition before creating render
  // resources. An already-cancelled request must not race renderer startup.
  const ready = await new Promise(resolve => {
    continueRendering = resolve;
    parentPort.postMessage({ type: 'composition', composition: {
      durationInFrames: composition.durationInFrames, width: composition.width, height: composition.height,
    } });
  });
  if (!ready || cancelled) throw new Error('CanceledByUser');
  await renderMedia({
    composition, serveUrl: bundledPath, codec: 'h264', outputLocation: outputPath,
    inputProps: { scriptData }, browserExecutable, cancelSignal,
    onProgress: progress => parentPort.postMessage({ type: 'progress', progress }),
  });
  parentPort.postMessage({ type: 'complete' });
} catch (error) {
  parentPort.postMessage({ type: 'failed', error: cancelled ? 'CanceledByUser' : error.message });
} finally {
  // Renderer promises settle after their own browser/server cleanup. Do not
  // terminate the worker early, which could leave Chromium/compositor children.
  parentPort.close();
}
