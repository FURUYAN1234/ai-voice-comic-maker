import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { installLocalSecurity, LOCAL_HOST } from '../local-security.js';
import { createVideoDelivery, recordCompletedVideo } from '../server/video-results.mjs';

const sessionId = 'session_12345678-0000-0000-0000-000000000000';
const filename = 'voice_comic_JP_風の灯台_20261128104116.mp4';
const title = '風の灯台';
const content = Buffer.concat([Buffer.from([0, 0, 0, 20]), Buffer.from('ftypisom'), Buffer.alloc(1568)]);

function makeResult(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'voice-video-'));
  t.after(() => {
    // The path is the fresh directory returned by mkdtemp inside the OS temp directory.
    assert.equal(path.dirname(dir), os.tmpdir());
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const root = path.join(dir, '.worktrees', 'app');
  fs.mkdirSync(path.join(root, 'out'), { recursive: true });
  fs.mkdirSync(path.join(root, 'temp', sessionId), { recursive: true });
  fs.writeFileSync(path.join(root, 'out', filename), content);
  recordCompletedVideo(root, { sessionId, filename, title });
  return root;
}

async function openServer(t, root) {
  const app = express();
  const server = app.listen(0, LOCAL_HOST);
  await new Promise(resolve => server.once('listening', resolve));
  const port = server.address().port;
  const base = `http://${LOCAL_HOST}:${port}`;
  installLocalSecurity(app, { apiPort: port });
  app.get('/api/video/:sessionId', createVideoDelivery(root));
  t.after(() => new Promise(resolve => server.close(resolve)));

  const session = await fetch(`${base}/api/local-session`, { headers: { 'X-Voice-Comic-Client': 'local-ui' } });
  assert.equal(session.status, 200);
  const cookie = session.headers.get('set-cookie').split(';')[0];
  await session.body.cancel();
  return { base, cookie, video: `${base}/api/video/${sessionId}` };
}

test('poster playback and native attachment stream the same file under a hidden parent', async t => {
  const root = makeResult(t);
  const { video, cookie } = await openServer(t, root);
  const range = await fetch(video, { headers: { Cookie: cookie, Range: 'bytes=4-11' } });
  assert.equal(range.status, 206);
  assert.equal(range.headers.get('content-disposition'), 'inline');
  assert.equal(range.headers.get('content-range'), `bytes 4-11/${content.length}`);
  assert.equal(range.headers.get('cache-control'), 'no-store');
  assert.deepEqual(Buffer.from(await range.arrayBuffer()), content.subarray(4, 12));

  const attachment = `${video}?download=1`;
  const head = await fetch(attachment, { method: 'HEAD', headers: { Cookie: cookie } });
  assert.equal(head.status, 200);
  assert.equal(head.headers.get('content-type'), 'video/mp4');
  assert.equal(head.headers.get('content-length'), String(content.length));
  assert.equal(decodeURIComponent(head.headers.get('x-voice-comic-filename')), filename);
  assert.equal(decodeURIComponent(head.headers.get('x-voice-comic-title')), title);
  assert.match(head.headers.get('content-disposition'), /^attachment;/);
  assert.match(head.headers.get('content-disposition'), new RegExp(`filename\\*=UTF-8''${encodeURIComponent(filename).replace('.', '\\.')}$`));

  const downloaded = await fetch(attachment, { headers: { Cookie: cookie } });
  assert.equal(downloaded.status, 200);
  assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()), content);
});

test('completed video survives a backend lifetime while invalid, missing and unauthenticated requests are denied', async t => {
  const root = makeResult(t);
  const old = await openServer(t, root);
  const current = await openServer(t, root);
  for (const headers of [{}, { Cookie: old.cookie }]) {
    const response = await fetch(`${current.video}?download=1`, { method: 'HEAD', headers });
    assert.equal(response.status, 401);
    assert.equal(response.headers.get('content-disposition'), null);
  }

  const headers = { Cookie: current.cookie };
  const video = await fetch(current.video, { method: 'HEAD', headers });
  assert.equal(video.status, 200);
  const invalid = await fetch(`${current.base}/api/video/%2e%2e%2fout?download=1`, { headers });
  assert.equal(invalid.status, 404);
  assert.equal(invalid.headers.get('content-disposition'), null);
  await invalid.body.cancel();

  const beyondEnd = await fetch(current.video, { headers: { ...headers, Range: 'bytes=900000-' } });
  assert.equal(beyondEnd.status, 416);
  assert.equal(beyondEnd.headers.get('content-range'), `bytes */${content.length}`);
  assert.equal(beyondEnd.headers.get('content-disposition'), null);
  await beyondEnd.body.cancel();

  fs.writeFileSync(path.join(root, 'temp', sessionId, 'video-result.json'), JSON.stringify({ filename: `../out/${filename}` }));
  assert.equal((await fetch(current.video, { method: 'HEAD', headers })).status, 404);
  recordCompletedVideo(root, { sessionId, filename, title });
  fs.unlinkSync(path.join(root, 'out', filename));
  assert.equal((await fetch(current.video, { method: 'HEAD', headers })).status, 404);
});
