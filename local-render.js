import { Worker } from 'node:worker_threads';

export function renderLocalVideo({ bundledPath, compositionId, scriptData, outputPath,
  browserExecutable, signal, onProgress = () => {}, onComposition = () => {}, onListener = () => {} }) {
  if(signal?.aborted)return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./render-worker.js', import.meta.url), {
      workerData: { bundledPath, compositionId, scriptData, outputPath, browserExecutable },
    });
    const abort=()=>{failure=signal.reason||Object.assign(new Error('CanceledByUser'),{name:'AbortError'});worker.postMessage({type:'cancel'});};
    let completed = false;
    let failure;
    signal?.addEventListener("abort",abort,{once:true});
    worker.on('message', message => {
      if (message.type === 'failed') failure ||= new Error(message.error);
      if (message.type === 'complete') completed = true;
      if (failure) return;
      try {
        if (message.type === 'progress') onProgress(message.progress);
        if (message.type === 'composition') {
          onComposition(message.composition);
          worker.postMessage({ type: 'continue' });
        }
        if (message.type === 'listener') onListener(message.address);
      } catch (error) {
        failure = error;
        worker.postMessage({ type: 'cancel' });
      }
    });
    worker.on('error', error => { failure ||= error; });
    worker.on('exit', code => {
      signal?.removeEventListener("abort",abort);
      if (failure) return reject(failure);
      if (!completed || code !== 0) return reject(new Error(`Render worker exited before completion (${code})`));
      resolve();
    });
  });
}
