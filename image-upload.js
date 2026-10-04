import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import multer from 'multer';
import { MAX_UPLOAD_BYTES } from './local-security.js';

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
