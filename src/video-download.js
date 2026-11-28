import { localApiFetch } from './local-api.js';

export async function readVideoInfo(url, signal) {
  let response;
  try {
    response = await localApiFetch(url, { method: 'HEAD', signal });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new Error('ローカルサーバーに接続できませんでした。もう一度お試しください。', { cause: error });
  }
  if (response.status === 401 || response.status === 403) {
    throw new Error('ローカル接続を確認できませんでした。もう一度お試しください。');
  }
  if (response.status === 404) throw new Error('保存期間内の完成動画が見つかりません。');
  if (!response.ok || response.headers.get('Content-Type')?.split(';')[0] !== 'video/mp4' ||
      !response.headers.has('X-Voice-Comic-Filename')) {
    throw new Error('動画を読み込めませんでした。もう一度お試しください。');
  }
  return {
    filename: decodeURIComponent(response.headers.get('X-Voice-Comic-Filename')),
    title: decodeURIComponent(response.headers.get('X-Voice-Comic-Title') ?? ''),
  };
}

export async function startVideoDownload(videoUrl, expectedFilename) {
  const url = `${videoUrl}?download=1`;
  const { filename } = await readVideoInfo(url);
  if (expectedFilename && filename !== expectedFilename) {
    throw new Error('表示中の動画と保存先の動画名が一致しません。完成画面を再読込してください。');
  }
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.hidden = true;
  document.body.append(link);
  try {
    link.click();
  } finally {
    link.remove();
  }
}
