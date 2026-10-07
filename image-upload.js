import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import multer from 'multer';
import { MAX_UPLOAD_BYTES } from './local-security.js';

function hasAllowedImageContent(file) {
  // 拡張子や申告MIMEだけでネイティブデコーダーへ渡さない。
  const header = Buffer.alloc(12);
  const fd = fs.openSync(file.path, 'r');
  let length;
  try { length = fs.readSync(fd, header, 0, header.length, 0); }
  finally { fs.closeSync(fd); }
  const extension = path.extname(file.originalname).toLowerCase();
  if (length >= 8 && header.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    return extension === '.png' && file.mimetype === 'image/png';
  }
  if (length >= 3 && header[0] === 255 && header[1] === 216 && header[2] === 255) {
    return ['.jpg', '.jpeg'].includes(extension) && file.mimetype === 'image/jpeg';
  }
  return length >= 12 && header.toString('ascii', 0, 4) === 'RIFF' &&
    header.toString('ascii', 8, 12) === 'WEBP' && extension === '.webp' && file.mimetype === 'image/webp';
}

export function createImageUpload(tempRoot) {
  const storage = multer.diskStorage({
    destination: (req, file, cb) => {
      const sessionId = `session_${randomUUID()}`;
      const dir = path.join(tempRoot, sessionId);
      try {
        fs.mkdirSync(dir, { recursive: true });
        req.sessionId = sessionId;
        req.uploadDir = dir;
        cb(null, dir);
      } catch (error) { cb(error); }
    },
    filename: (req, file, cb) => cb(null, `source${path.extname(file.originalname).toLowerCase()}`),
  });
  const upload = multer({
    storage,
    // Busboy emits its limit at equality; +1 keeps the documented max inclusive.
    limits: { fileSize: MAX_UPLOAD_BYTES + 1, files: 1, fields: 0, parts: 2, fieldNameSize: 100 },
    fileFilter: (req, file, cb) => {
      if (/\.(png|jpg|jpeg|webp)$/i.test(file.originalname) &&
          ['image/png', 'image/jpeg', 'image/webp'].includes(file.mimetype)) return cb(null, true);
      const error = new Error('画像ファイル (.png/.jpg/.webp) のみアップロード可能です');
      error.status = 415;
      cb(error);
    },
  }).single('image');
  return (req, res, next) => upload(req, res, error => {
    if (!error && req.file) {
      try {
        if (!hasAllowedImageContent(req.file)) {
          error = Object.assign(new Error('UNSUPPORTED_IMAGE_CONTENT'), { status: 415 });
        }
      } catch {
        error = Object.assign(new Error('IMAGE_CONTENT_CHECK_FAILED'), { status: 400 });
      }
    }
    if (!error) return next();
    // Only this failed request's fresh directory is removed, never previous assets.
    try {
      if (req.uploadDir) fs.rmSync(req.uploadDir, { recursive: true, force: true });
    } catch {
      return res.status(500).json({ error: 'UPLOAD_CLEANUP_FAILED' });
    }
    const status = error.code?.startsWith('LIMIT_') ? 413 : (error.status || 400);
    res.status(status).json({ error: error.code || error.message, maxUploadBytes: MAX_UPLOAD_BYTES });
  });
}
