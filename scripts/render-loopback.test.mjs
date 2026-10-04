import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import sharp from 'sharp';
import { bundle } from '@remotion/bundler';
import { restrictRenderListeners } from '../render-loopback.js';
import { renderLocalVideo } from '../local-render.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

test('render-only restriction covers TCP overloads, rejects handles/pipes, leaves main untouched', async () => {
  const original = net.Server.prototype.listen;
  const originalEmit = http.Server.prototype.emit;
  assert.throws(() => restrictRenderListeners(), /dedicated worker/);
  const worker = new Worker(`
    const { parentPort } = require('node:worker_threads');
    (async () => {
      const net = require('node:net');
      const http = require('node:http');
      const { restrictRenderListeners } = await import(${JSON.stringify(new URL('../render-loopback.js', import.meta.url).href)});
      const addresses = [];
      restrictRenderListeners(address => addresses.push(address.address));
      for (const args of [[0], [0, '0.0.0.0'], [0, '::', 8], [{ port: 0, host: '0.0.0.0' }], [{ port: 0 }]]) {
        const server = net.createServer();
        await new Promise((resolve, reject) => { server.once('error', reject); server.listen(...args, resolve); });
        await new Promise(resolve => server.close(resolve));
      }
      let refused = 0;
      for (const args of [['pipe'], [{ fd: 1 }], [{ handle: {} }], [{ port: 0, path: 'pipe' }], [0, '192.0.2.1'], [{ port: 0, _handle: {} }]]) {
        try { net.createServer().listen(...args); } catch { refused++; }
      }
      let handled = 0;
      const server = http.createServer((req, res) => { handled++; res.end('fixture'); });
      await new Promise(resolve => server.listen(0, resolve));
      const port = server.address().port;
      const statuses = [];
      for (const headers of [{}, { Origin: 'http://localhost:'+port }, { Origin: 'https://untrusted.example' },
        { Origin: 'null' }, { Host: 'evil.example:'+port }, { 'Sec-Fetch-Site': 'cross-site' }]) {
        statuses.push(await new Promise((resolve, reject) => {
          const req = http.get({ host: '127.0.0.1', port, path: '/proxy?src=fixture', headers }, res => {
            res.resume(); res.on('end', () => resolve(res.statusCode));
          }); req.on('error', reject);
        }));
      }
      await new Promise(resolve => server.close(resolve));
      parentPort.postMessage({ addresses, refused, handled, statuses });
    })().catch(error => { throw error; });
  `, { eval: true });
  const result = await new Promise((resolve, reject) => {
    let message;
    worker.on('message', value => { message = value; });
    worker.on('error', reject);
    worker.on('exit', code => code === 0 ? resolve(message) : reject(new Error(`exit ${code}`)));
  });
  assert.deepEqual(result.addresses, Array(6).fill('127.0.0.1'));
  assert.equal(result.refused, 6);
  assert.equal(result.handled, 2);
  assert.deepEqual(result.statuses, [200, 200, 403, 403, 403, 403]);
  assert.equal(net.Server.prototype.listen, original);
  assert.equal(http.Server.prototype.emit, originalEmit);
});

function silentWav() {
  const wav = Buffer.alloc(44 + 48000);
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(24000, 24); wav.writeUInt32LE(48000, 28); wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(48000, 40);
  return wav;
}

async function assertClosed(addresses) {
  assert.ok(addresses.length > 0, 'actual renderer must start observed listeners');
  for (const address of addresses) {
    assert.equal(address.address, '127.0.0.1');
    const reachable = await new Promise(resolve => {
      const socket = net.connect(address.port, address.address);
      socket.once('connect', () => { socket.destroy(); resolve(true); });
      socket.once('error', () => resolve(false));
    });
    assert.equal(reachable, false, `renderer listener ${address.port} must close before returning`);
  }
}

test('real application renders a synthetic image/audio MP4 and closes listeners on success/error/cancel', async t => {
  const browserExecutable = process.env.REMOTION_BROWSER_EXECUTABLE;
  assert.ok(browserExecutable && fs.existsSync(browserExecutable), 'Set REMOTION_BROWSER_EXECUTABLE to an installed Chrome headless shell; no download is performed');
  const existingFixture = process.env.VOICE_RENDER_FIXTURE_DIR;
  const dir = existingFixture || fs.mkdtempSync(path.join(os.tmpdir(), 'voice-render-fixture-'));
  if (!existingFixture) t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const name of ['panels', 'audio', 'voiceover']) fs.mkdirSync(path.join(dir, 'runtime', name), { recursive: true });
  await sharp({ create: { width: 64, height: 64, channels: 3, background: '#336699' } }).png().toFile(path.join(dir, 'runtime/panels/fixture.png'));
  for (const name of ['audio', 'voiceover']) fs.writeFileSync(path.join(dir, 'runtime', name, 'fixture.wav'), silentWav());
  const bundledPath = existingFixture ? path.join(dir, 'bundle') : await bundle({ entryPoint: path.join(root, 'src/index.ts'), publicDir: path.join(dir, 'runtime'),
    outDir: path.join(dir, 'bundle'), enableCaching: false,
  });
  const scriptData = { panels: ['panels/fixture.png'], totalDurationInFrames: 2, bgmAudio: 'audio/fixture.wav',
    dialogues: [{ id: 'fixture', speaker: 'Test', text: 'Synthetic fixture', panelIndex: 0,
      durationInFrames: 2, audioFile: 'voiceover/fixture.wav' }],
  };
  const outputPath = path.join(dir, 'fixture.mp4');
  const options = { bundledPath, compositionId: 'VoiceComic', scriptData, outputPath, browserExecutable };
  const addresses = [];
  await renderLocalVideo({ ...options, onListener: address => addresses.push(address) });
  assert.ok(fs.statSync(outputPath).size > 0);
  await assertClosed(addresses);
  console.log('Synthetic MP4 rendered; successful render listeners closed');
  if (process.env.VOICE_RENDER_EVIDENCE) fs.copyFileSync(outputPath, process.env.VOICE_RENDER_EVIDENCE);

  const failedListeners = [];
  await assert.rejects(renderLocalVideo({ ...options, compositionId: 'MissingFixture',
    onListener: address => failedListeners.push(address),
  }), /MissingFixture|composition/i);
  await assertClosed(failedListeners);
  console.log('Missing composition rejected; failed render listeners closed');

  const cancelledListeners = [];
  await assert.rejects(renderLocalVideo({ ...options,
    onListener: address => cancelledListeners.push(address),
    onComposition: () => { throw new Error('FixtureCancelled'); },
  }), /FixtureCancelled/);
  await assertClosed(cancelledListeners);
  console.log('Cancelled render settled; cancelled render listeners closed');
  const activeCancelledListeners = [];
  await assert.rejects(renderLocalVideo({ ...options, outputPath: path.join(dir, 'cancelled.mp4'),
    scriptData: { ...scriptData, totalDurationInFrames: 30, dialogues: [{ ...scriptData.dialogues[0], durationInFrames: 30 }] },
    onListener: address => activeCancelledListeners.push(address),
    onProgress: ({ renderedFrames }) => { if (renderedFrames > 0) throw new Error('FixtureActiveCancelled'); },
  }), /FixtureActiveCancelled/);
  await assertClosed(activeCancelledListeners);
  console.log('Active render cancellation settled; active render listeners closed');
  const ffmpeg = path.join(root, 'node_modules/@remotion/compositor-win32-x64-msvc/ffmpeg.exe');
  execFileSync(ffmpeg, ['-v', 'error', '-i', outputPath, '-c:v', 'rawvideo', '-c:a', 'pcm_s16le', '-f', 'null', '-'], { stdio: 'pipe' });
  console.log(`Observed renderer TCP listeners: success=${addresses.length}, error=${failedListeners.length}, cancel=${cancelledListeners.length}, activeCancel=${activeCancelledListeners.length}; all loopback and closed`);
});
