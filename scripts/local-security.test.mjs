import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import express from 'express';
import { installLocalSecurity, LOCAL_HOST, MAX_UPLOAD_BYTES } from '../local-security.js';
import { createImageUpload } from '../image-upload.js';

async function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'voice-security-'));
  const app = express();
  const server = app.listen(0, LOCAL_HOST);
  await new Promise(resolve => server.once('listening', resolve));
  const port = server.address().port;
  installLocalSecurity(app, { apiPort: port });
  app.use(express.json({ limit: '64kb' }));
  let operations = 0;
  app.get('/api/status', (req, res) => res.json({ ok: true }));
  app.post('/api/analyze', (req, res) => { operations++; res.json({ ok: true }); });
  app.delete('/api/cancel', (req, res) => { operations++; res.json({ ok: true }); });
  app.post('/api/upload', createImageUpload(dir), (req, res) => res.json({ size: req.file?.size }));
  app.use((error, req, res, next) => res.status(error.status || 500).json({ error: error.type }));
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const url = `http://${LOCAL_HOST}:${port}`;
  async function session() {
    const response = await fetch(`${url}/api/local-session`, { headers: { 'X-Voice-Comic-Client': 'local-ui' } });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('set-cookie'), /HttpOnly; SameSite=Strict; Path=\/api/);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    return { Cookie: response.headers.get('set-cookie').split(';')[0], 'X-Voice-Comic-CSRF': (await response.json()).csrfToken };
  }
  return { url, port, dir, session, operations: () => operations };
}

test('anonymous state, charged route and upload are denied before any work', async t => {
  const f = await fixture(t);
  for (const [route, method] of [['status', 'GET'], ['analyze', 'POST'], ['cancel', 'DELETE'], ['upload', 'POST']]) {
    const response = await fetch(`${f.url}/api/${route}`, { method });
    assert.equal(response.status, 401);
  }
  assert.equal(f.operations(), 0);
  assert.deepEqual(fs.readdirSync(f.dir), []);
});

test('foreign/null origins, DNS-rebinding host and cross-site no-origin requests are denied', async t => {
  const f = await fixture(t);
  const auth = await f.session();
  for (const headers of [
    { Origin: 'https://evil.example' }, { Origin: 'null' },
    { Origin: 'http://localhost:9999' },
    { 'Sec-Fetch-Site': 'cross-site' },
  ]) {
    const response = await fetch(`${f.url}/api/analyze`, { method: 'POST', headers: { ...auth, ...headers } });
    assert.equal(response.status, 403, JSON.stringify(headers));
    assert.equal(response.headers.get('access-control-allow-origin'), null);
    const bootstrap = await fetch(`${f.url}/api/local-session`, { headers: { 'X-Voice-Comic-Client': 'local-ui', ...headers } });
    assert.equal(bootstrap.status, 403);
  }
  // fetch normalizes Host; use an actual HTTP request for DNS-rebinding coverage.
  const hostileHostStatus = await new Promise((resolve, reject) => {
    const req = http.request(`${f.url}/api/analyze`, {
      method: 'POST', headers: { ...auth, Host: `evil.example:${f.port}` },
    }, res => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
    req.on('error', reject); req.end();
  });
  assert.equal(hostileHostStatus, 403);
  assert.equal(f.operations(), 0);
});

test('HTML navigation cannot bootstrap; CORS preflight is denied', async t => {
  const f = await fixture(t);
  assert.equal((await fetch(`${f.url}/api/local-session`)).status, 403);
  const preflight = await fetch(`${f.url}/api/local-session`, {
    method: 'OPTIONS', headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'GET' },
  });
  assert.equal(preflight.status, 403);
  assert.equal(preflight.headers.get('access-control-allow-origin'), null);
});

test('cookie reads/media work, mutations require CSRF, local UI origin works', async t => {
  const f = await fixture(t);
  const auth = await f.session();
  assert.equal((await fetch(`${f.url}/api/status`, { headers: { Cookie: auth.Cookie } })).status, 200);
  for (const headers of [{ Cookie: auth.Cookie }, { ...auth, 'X-Voice-Comic-CSRF': 'bad' }]) {
    assert.equal((await fetch(`${f.url}/api/analyze`, { method: 'POST', headers })).status, 403);
  }
  assert.equal((await fetch(`${f.url}/api/analyze`, { method: 'POST', headers: { ...auth, Origin: 'http://127.0.0.1:5174' } })).status, 200);
  assert.equal(f.operations(), 1);
});

test('credentials cannot be replayed into another backend lifetime', async t => {
  const first = await fixture(t);
  const second = await fixture(t);
  const auth = await first.session();
  assert.equal((await fetch(`${second.url}/api/status`, { headers: auth })).status, 401);
});

function multipart(bytes, extra = '') {
  return Buffer.concat([
    Buffer.from('--fixture\r\nContent-Disposition: form-data; name="image"; filename="fixture.png"\r\nContent-Type: image/png\r\n\r\n'),
    Buffer.alloc(bytes, 1), Buffer.from(`\r\n${extra}--fixture--\r\n`),
  ]);
}

test('upload accepts the exact limit and rejects limit+1 without Content-Length, preserving prior files', async t => {
  const f = await fixture(t);
  const auth = await f.session();
  const headers = { ...auth, 'Content-Type': 'multipart/form-data; boundary=fixture' };
  const ok = await fetch(`${f.url}/api/upload`, { method: 'POST', headers, body: multipart(MAX_UPLOAD_BYTES) });
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).size, MAX_UPLOAD_BYTES);
  const retained = fs.readdirSync(f.dir);
  const body = multipart(MAX_UPLOAD_BYTES + 1);
  const status = await new Promise((resolve, reject) => {
    const req = http.request(`${f.url}/api/upload`, { method: 'POST', headers }, res => {
      res.resume(); res.on('end', () => resolve(res.statusCode));
    });
    req.on('error', reject);
    req.write(body.subarray(0, 1024)); req.end(body.subarray(1024));
  });
  assert.equal(status, 413);
  assert.deepEqual(fs.readdirSync(f.dir), retained);
});

test('extra multipart files/fields and oversized JSON cannot reach operations', async t => {
  const f = await fixture(t);
  const auth = await f.session();
  const extraField = '--fixture\r\nContent-Disposition: form-data; name="extra"\r\n\r\nx\r\n';
  const upload = await fetch(`${f.url}/api/upload`, {
    method: 'POST', headers: { ...auth, 'Content-Type': 'multipart/form-data; boundary=fixture' }, body: multipart(1, extraField),
  });
  assert.equal(upload.status, 413);
  assert.deepEqual(fs.readdirSync(f.dir), []);
  const secondFile = '--fixture\r\nContent-Disposition: form-data; name="image"; filename="second.png"\r\nContent-Type: image/png\r\n\r\nx\r\n';
  const multiple = await fetch(`${f.url}/api/upload`, {
    method: 'POST', headers: { ...auth, 'Content-Type': 'multipart/form-data; boundary=fixture' }, body: multipart(1, secondFile),
  });
  assert.equal(multiple.status, 413);
  assert.deepEqual(fs.readdirSync(f.dir), []);
  const json = await fetch(`${f.url}/api/analyze`, {
    method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'x'.repeat(65536) }),
  });
  assert.equal(json.status, 413);
  assert.equal(f.operations(), 0);
});
