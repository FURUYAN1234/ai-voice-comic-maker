import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import express from 'express';
import sharp from 'sharp';
import { createServer, build } from 'vite';
import { bundle } from '@remotion/bundler';
import configFactory from '../vite.config.js';
import { installLocalSecurity, LOCAL_HOST } from '../local-security.js';
import { createImageUpload } from '../image-upload.js';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const marker = 'PRIVATE_RUNTIME_TEST_FIXTURE';
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'voice-assets-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><title>Local fixture</title>');
  for (const relative of ['public/panels/old.png', 'public/voiceover/old.wav', 'public/audio/old.wav',
    '.runtime/panels/new.png', '.runtime/voiceover/new.wav', '.runtime/audio/new.wav', 'temp/source.png', 'out/video.mp4']) {
    const filename = path.join(dir, relative);
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    fs.writeFileSync(filename, marker);
  }
  fs.writeFileSync(path.join(dir, 'public/LICENSE.txt'), 'Public license fixture');
  return dir;
}

test('production build excludes new and legacy private assets without deleting originals', async t => {
  const dir = fixture(t);
  const config = configFactory({ command: 'build' });
  await build({ ...config, root: dir, configFile: false, logLevel: 'silent' });
  assert.deepEqual(fs.readdirSync(path.join(dir, 'dist')).sort(), ['.nojekyll', 'LICENSE.txt', 'index.html']);
  assert.equal(fs.readFileSync(path.join(dir, 'dist/LICENSE.txt'), 'utf8'), 'Public license fixture');
  assert.equal(fs.readFileSync(path.join(dir, 'public/panels/old.png'), 'utf8'), marker);
  assert.equal(fs.readFileSync(path.join(dir, '.runtime/voiceover/new.wav'), 'utf8'), marker);
});

test('local Vite blocks direct private file URLs while proxy handshake/upload/media remains usable', async t => {
  const dir = fixture(t);
  const app = express();
  const backend = app.listen(0, LOCAL_HOST);
  await new Promise(resolve => backend.once('listening', resolve));
  t.after(() => new Promise(resolve => backend.close(resolve)));
  const config = configFactory({ command: 'serve' });
  // Vite treats port 0 as its default; reserve a real free port for this fixture.
  const reservation = net.createServer();
  await new Promise(resolve => reservation.listen(0, LOCAL_HOST, resolve));
  const fixturePort = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  const vite = await createServer({ ...config, root: dir, configFile: false, logLevel: 'silent',
    server: { ...config.server, port: fixturePort, proxy: { '/api': {
      ...config.server.proxy['/api'], target: `http://127.0.0.1:${backend.address().port}`,
    } } },
  });
  t.after(() => vite.close());
  await vite.listen();
  const port = vite.httpServer.address().port;
  assert.equal(vite.httpServer.address().address, LOCAL_HOST);
  assert.equal(backend.address().address, LOCAL_HOST);
  installLocalSecurity(app, { apiPort: backend.address().port, uiPort: port });
  app.post('/api/upload', createImageUpload(path.join(dir, 'upload')), (req, res) => res.json({ size: req.file.size }));
  app.get('/api/video/fixture', (req, res) => res.sendFile(path.join(dir, 'out/video.mp4')));
  const url = `http://127.0.0.1:${port}`;
  for (const relative of ['public/panels/old.png', 'public/voiceover/old.wav', 'public/audio/old.wav',
    '.runtime/panels/new.png', '.runtime/audio/new.wav', 'temp/source.png', 'out/video.mp4',
    `@fs/${path.join(dir, '.runtime/panels/new.png').replaceAll('\\', '/')}`]) {
    const response = await fetch(`${url}/${relative}`);
    assert.equal(response.status, 403, relative);
    assert.ok(!(await response.text()).includes(marker));
  }
  const handshake = await fetch(`${url}/api/local-session`, {
    headers: { 'X-Voice-Comic-Client': 'local-ui', Origin: url },
  });
  assert.equal(handshake.status, 200);
  const cookie = handshake.headers.get('set-cookie').split(';')[0];
  const csrfToken = (await handshake.json()).csrfToken;
  const form = new FormData();
  const image = await sharp({ create: { width: 1, height: 1, channels: 3, background: '#369' } }).png().toBuffer();
  form.append('image', new Blob([image], { type: 'image/png' }), 'fixture.png');
  const upload = await fetch(`${url}/api/upload`, { method: 'POST', body: form,
    headers: { Cookie: cookie, 'X-Voice-Comic-CSRF': csrfToken, Origin: url },
  });
  assert.equal(upload.status, 200);
  assert.equal((await upload.json()).size, image.length);
  // HTML <video> and download links send cookies without custom CSRF headers.
  const video = await fetch(`${url}/api/video/fixture`, { headers: { Cookie: cookie } });
  assert.equal(video.status, 200);
  assert.equal(await video.text(), marker);
});

test('Remotion receives private runtime assets, excluding legacy public assets', async t => {
  const dir = fixture(t);
  const bundled = await bundle({ entryPoint: path.join(root, 'src/index.ts'),
    publicDir: path.join(dir, '.runtime'), outDir: path.join(dir, 'render-bundle'), enableCaching: false,
  });
  assert.equal(fs.readFileSync(path.join(bundled, 'public/panels/new.png'), 'utf8'), marker);
  assert.equal(fs.existsSync(path.join(bundled, 'public/panels/old.png')), false);
  const serverSource = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
  assert.match(serverSource, /publicDir: RUNTIME_DIR/);
  assert.doesNotMatch(serverSource, /path\.join\(__dirname, 'public', '(panels|voiceover|audio)'/);
});
