import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { open, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const project = fileURLToPath(new URL('../', import.meta.url));
const invalid = () => Object.assign(new Error('Invalid application artifact.'), { code: 'OUTPUT_INVALID' });
const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function imageType(bytes) {
  if (bytes.length >= 45 && bytes.subarray(0, 8).equals(png)) return ['png', 'image/png'];
  if (bytes.length >= 12 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 && bytes.at(-2) === 255 && bytes.at(-1) === 217) return ['jpg', 'image/jpeg'];
  if (bytes.length >= 16 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP' && bytes.readUInt32LE(4) + 8 === bytes.length) return ['webp', 'image/webp'];
  throw invalid();
}

async function saveImage(dir, { kind, imageData }) {
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(imageData);
  if (!match) throw invalid();
  const bytes = Buffer.from(match[2], 'base64');
  if (bytes.toString('base64') !== match[2]) throw invalid();
  const [ext, mimeType] = imageType(bytes);
  if (mimeType !== match[1]) throw invalid();
  if (kind === 'panorama' && (ext !== 'jpg' || !bytes.includes('GPano:ProjectionType') || !bytes.includes('equirectangular'))) throw invalid();
  const file = path.join(dir, (kind === 'panorama' ? 'panorama' : 'image') + '.' + ext);
  await writeFile(file, bytes, { mode: 0o600, flag: 'wx' });
  return { path: file, mimeType, sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length };
}

async function saveVideo(dir, videoPath, videoFilename) {
  if (!/^voice_comic_[^<>:"/\\|?*\x00-\x1f]+\.mp4$/i.test(videoFilename)) throw invalid();
  const allowed = path.join(await realpath(path.join(project, 'out')), videoFilename);
  if (!path.isAbsolute(videoPath) || await realpath(videoPath) !== allowed) throw invalid();
  const source = await open(allowed, 'r');
  try {
    const stats = await source.stat();
    const header = Buffer.alloc(12);
    const { bytesRead } = await source.read(header, 0, header.length, 0);
    if (!stats.isFile() || bytesRead !== header.length || header.toString('ascii', 4, 8) !== 'ftyp') throw invalid();
    const file = path.join(dir, videoFilename);
    const hash = createHash('sha256');
    let size = 0;
    const meter = new Transform({ transform(chunk, _, done) { hash.update(chunk); size += chunk.length; done(null, chunk); } });
    await pipeline(createReadStream(allowed, { fd: source.fd, autoClose: false, start: 0 }), meter, createWriteStream(file, { mode: 0o600, flags: 'wx' }));
    if (size !== stats.size) throw invalid();
    return { path: file, mimeType: 'video/mp4', sha256: hash.digest('hex'), bytes: size };
  } finally { await source.close(); }
}

export async function persistArtifact(dir, result) {
  const { imageData, videoPath, videoFilename, ...fields } = result;
  if (imageData) fields.image = await saveImage(dir, { imageData, kind: fields.kind });
  if (videoPath) fields.video = await saveVideo(dir, videoPath, videoFilename);
  return fields;
}
