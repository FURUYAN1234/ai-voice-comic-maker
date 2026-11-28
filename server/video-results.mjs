import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { isVideoSessionId } from '../src/video-session.js';

const videoFilenamePattern = /^voice_comic_(?:JP|EN)_[^<>:"/\\|?*\x00-\x1f]*_\d{14}\.mp4$/u;
const resultPath = (root, sessionId) => path.join(root, 'temp', sessionId, 'video-result.json');

export function recordCompletedVideo(root, { sessionId, filename, title }) {
  if (!isVideoSessionId(sessionId) || !videoFilenamePattern.test(filename) ||
      !fs.lstatSync(path.join(root, 'out', filename)).isFile()) {
    throw new Error('完成動画の保存情報を記録できませんでした。');
  }
  const record = resultPath(root, sessionId);
  const pending = `${record}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(pending, JSON.stringify({ filename, title }), { flag: 'wx' });
    fs.renameSync(pending, record);
  } finally {
    fs.rmSync(pending, { force: true });
  }
}

export function createVideoDelivery(root) {
  const out = path.join(root, 'out');
  return async (req, res) => {
    const notFound = () => res.status(404).json({ error: '保存期間内の完成動画が見つかりません。' });
    const { sessionId } = req.params;
    if (!isVideoSessionId(sessionId)) return notFound();

    let result;
    try {
      result = JSON.parse(await fs.promises.readFile(resultPath(root, sessionId), 'utf8'));
      if (typeof result?.filename !== 'string' || !videoFilenamePattern.test(result.filename) ||
          !(await fs.promises.lstat(path.join(out, result.filename))).isFile()) return notFound();
    } catch (error) {
      if (error.code === 'ENOENT' || error instanceof SyntaxError) return notFound();
      return res.status(500).json({ error: '完成動画を読み込めませんでした。' });
    }

    const { filename, title } = result;
    if (req.query.download === '1') res.attachment(filename);
    else res.setHeader('Content-Disposition', 'inline');
    res.type('video/mp4');
    res.setHeader('X-Voice-Comic-Filename', encodeURIComponent(filename.toWellFormed()));
    res.setHeader('X-Voice-Comic-Title', encodeURIComponent(Array.from(String(title ?? '').toWellFormed()).slice(0, 200).join('')));

    // Express checks dotfiles relative to `root`, including when a parent folder is hidden.
    res.sendFile(filename, { root: out, dotfiles: 'deny', cacheControl: false }, error => {
      if (!error || res.destroyed) return;
      if (res.headersSent) return res.destroy();
      res.removeHeader('Content-Disposition');
      res.removeHeader('Content-Type');
      res.removeHeader('X-Voice-Comic-Filename');
      res.removeHeader('X-Voice-Comic-Title');
      if (error.status === 404) return notFound();
      res.status(error.status === 416 ? 416 : 500).json({ error: '動画を配信できませんでした。' });
    });
  };
}
