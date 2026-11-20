import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, readdir, realpath, rename, writeFile } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { persistArtifact } from './artifacts.mjs';

const states = new Set(['queued', 'running', 'cancelling']);
const heartbeatTimeout = 90000;
const maxBody = 28_000_000;
const safeCode = /^[A-Z][A-Z_]{1,63}$/;
const secretPattern = /(?:\bsk-[A-Za-z0-9_-]{18,}|\bAIza[A-Za-z0-9_-]{25,}|\bBearer [A-Za-z0-9_-]{20,})/;
const hash = value => createHash('sha256').update(value).digest('hex');
const secret = () => randomBytes(32).toString('base64url');
const identityMatches = (left, right) => ['app', 'version', 'contract', 'source'].every(key => left?.[key] === right[key]);

export const fail = (code, message, status = 409) => Object.assign(new Error(message), { code, status });

async function lockWorkspace(workspace) {
  // A live OS lease is released automatically even if the process crashes.
  const digest = hash(process.platform === 'win32' ? workspace.toLowerCase() : workspace);
  const address = process.platform === 'win32' ? '\\\\.\\pipe\\furu-app-mcp-' + digest
    : process.platform === 'linux' ? '\0furu-app-mcp-' + digest : null;
  if (!address) throw fail('LEASE_UNSUPPORTED', 'The local MCP server supports Windows and Linux.');
  const server = net.createServer(socket => socket.destroy());
  await new Promise((resolve, reject) => {
    server.once('error', error => reject(fail('WORKSPACE_BUSY', 'Cannot lock the MCP workspace (' + error.code + ').')));
    server.listen({ path: address, exclusive: true }, resolve);
  });
  return () => new Promise(resolve => server.close(resolve));
}

function authMatches(header, token) {
  if (!token || typeof header !== 'string') return false;
  const supplied = Buffer.from(header);
  const expected = Buffer.from('Bearer ' + token);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

async function readJson(request) {
  if (Number(request.headers['content-length']) > maxBody) throw fail('INPUT_TOO_LARGE', 'The request exceeds the size limit.', 413);
  const chunks = [];
  let length = 0;
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    length += chunk.length;
    if (length > maxBody) throw fail('INPUT_TOO_LARGE', 'The request exceeds the size limit.', 413);
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw fail('INVALID_JSON', 'Send a valid JSON request.', 400); }
}

async function atomicJson(file, value) {
  const pending = file + '.' + randomUUID() + '.tmp';
  await writeFile(pending, JSON.stringify(value) + '\n', { mode: 0o600, flag: 'wx' });
  await rename(pending, file);
}

function expose(job) {
  const { input, digest, requestId, ...rest } = job;
  return { ...rest, requestId };
}

async function saveResult(workspace, job, result) {
  const dir = path.join(workspace, job.id);
  await mkdir(dir, { mode: 0o700 });
  const data = await persistArtifact(dir, result);
  const manifestPath = path.join(dir, 'result.json');
  await atomicJson(manifestPath, data);
  return { ...data, manifestPath };
}

export async function createBridge({ identity, operation, output, directory, service }) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const workspace = await realpath(directory);
  const unlock = await lockWorkspace(workspace);
  const jobs = new Map();
  const requestIds = new Map();
  let pairing;
  let client;
  let current;
  let handlingResult = false;
  let stopping = false;

  const persist = job => atomicJson(path.join(workspace, job.id + '.json'), job);
  try {
    for (const entry of await readdir(workspace, { withFileTypes: true })) {
      if (!entry.isFile() || !/^[0-9a-f-]{36}\.json$/.test(entry.name)) continue;
      const saved = JSON.parse(await readFile(path.join(workspace, entry.name), 'utf8'));
      if (saved.app !== identity.app || entry.name !== saved.id + '.json' || requestIds.has(saved.requestId)) throw fail('WORKSPACE_MISMATCH', 'This workspace contains jobs for a different application or inconsistent job records.');
      if (states.has(saved.state)) {
        saved.state = saved.state === 'queued' ? 'cancelled' : 'unknown';
        saved.code = 'SERVICE_RESTARTED';
        await persist(saved);
      }
      jobs.set(saved.id, saved);
      requestIds.set(saved.requestId, saved.id);
    }
  } catch (error) {
    await unlock();
    throw error;
  }

  async function finish(job, state, code, result) {
    const terminal = { ...job, state, code, result, completedAt: new Date().toISOString() };
    delete terminal.input;
    await persist(terminal);
    jobs.set(job.id, terminal);
    if (current?.id === job.id) current = undefined;
    return terminal;
  }

  async function disconnect() {
    client = undefined;
    if (!current || handlingResult) return;
    const state = current.state === 'queued' ? 'cancelled' : 'unknown';
    await finish(current, state, 'APP_DISCONNECTED');
  }

  async function expireClient() {
    if (client && Date.now() - client.seen > heartbeatTimeout) await disconnect();
  }

  // All state transitions are serialized across the tools and the browser.
  let pending = Promise.resolve();
  const ordered = fn => {
    const result = pending.then(fn);
    pending = result.catch(() => {});
    return result;
  };

  const get = id => {
    const job = jobs.get(id);
    if (!job) throw fail('JOB_NOT_FOUND', 'This workspace has no job with that ID.', 404);
    return job;
  };

  function configurePreviewServer(server) {
    const base = server.config.base;
    const marker = base + '__furu_mcp__/';
    const address = server.httpServer.address();
    const expectedHost = '127.0.0.1:' + (address?.port ?? server.config.preview.port);
    const origin = 'http://' + expectedHost;
    const answer = (response, status, body) => {
      response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      response.end(JSON.stringify(body));
    };
    server.middlewares.use(async (req, res, next) => {
      const route = req.url?.startsWith(marker) ? req.url.slice(marker.length) : null;
      if (route === null) return next();
      try {
        if (req.headers.host !== expectedHost || (req.headers.origin && req.headers.origin !== origin)) throw fail('ORIGIN_REJECTED', 'Use the paired application origin.', 403);
        if (service && ['health', 'server', 'stop'].includes(route)) {
          if (!authMatches(req.headers.authorization, service.token)) throw fail('AUTH_REQUIRED', 'Use the local MCP service credentials.', 401);
          if (route === 'health' && req.method === 'GET') return answer(res, 200, await service.health());
          if (route === 'stop' && req.method === 'POST') {
            if (!await service.stop()) throw fail('APP_BUSY', 'Finish or stop the active job before stopping the service.');
            return answer(res, 200, { stopping: true });
          }
          if (route === 'server') return await service.handle(req, res);
          throw fail('METHOD_NOT_ALLOWED', 'Unsupported service method.', 405);
        }
        if (stopping) throw fail('SERVICE_STOPPING', 'This service is shutting down.');
        if (req.method !== 'POST') throw fail('METHOD_NOT_ALLOWED', 'Use POST.', 405);
        const localConnect = route === 'connect_local';
        const authorizing = route === 'connect' || localConnect;
        if (localConnect && (req.headers.origin !== origin || req.headers['sec-fetch-site'] !== 'same-origin' || !req.headers['content-type']?.startsWith('application/json'))) {
          throw fail('ORIGIN_REJECTED', 'Start a local connection from the application page.', 403);
        }
        if (!localConnect && !authMatches(req.headers.authorization, authorizing ? pairing?.token : client?.token)) throw fail('AUTH_REQUIRED', 'Open a new pairing link from the MCP client.', 401);
        const data = await readJson(req);
        const body = await ordered(async () => {
          await expireClient();
          if (!localConnect && !authMatches(req.headers.authorization, authorizing ? pairing?.token : client?.token)) throw fail('AUTH_REQUIRED', 'The application session changed.', 401);
          if (authorizing) {
            if (!localConnect && Date.now() > pairing.expiresAt) throw fail('PAIRING_EXPIRED', 'Request a new pairing link.', 401);
            if (!identityMatches(data, identity)) throw fail('BUILD_MISMATCH', 'Open the current build of the exact target application.');
            if (client && ((!localConnect && !pairing.replaceIdle) || current)) throw fail('CLIENT_BUSY', 'An application is already connected.');
            pairing = undefined;
            client = { token: secret(), seen: Date.now(), providerReady: false };
            return { token: client.token };
          }
          client.seen = Date.now();
          if (route === 'disconnect') {
            await disconnect();
            return { disconnected: true };
          }
          if (route === 'poll') {
            client.providerReady = data.providerReady === true;
            if (current?.state === 'cancelling') return { cancel: current.id };
            if (!data.busy && data.accepting && current?.state === 'queued') {
              const running = { ...current, state: 'running', startedAt: new Date().toISOString() };
              await persist(running);
              current = running;
              jobs.set(current.id, current);
              return { job: { id: current.id, operation, input: current.input } };
            }
            return {};
          }
          if (route === 'result') {
            if (current?.id !== data.id || !['running', 'cancelling'].includes(current.state)) throw fail('JOB_MISMATCH', 'This job is no longer assigned to the application.');
            const job = current;
            if (data.state === 'failed' && data.code === 'CANCEL_CONFIRMATION_FAILED') {
              await finish(job, 'unknown', data.code);
              return { accepted: true };
            }
            if (job.state === 'cancelling' || data.state === 'cancelled') {
              await finish(job, 'cancelled', 'CANCELLED');
              return { accepted: true };
            }
            if (data.state === 'failed') {
              await finish(job, 'failed', safeCode.test(data.code) ? data.code : 'APP_OPERATION_FAILED');
              return { accepted: true };
            }
            if (data.state !== 'succeeded') throw fail('INVALID_RESULT', 'Unknown result state.', 400);
            const checked = output.safeParse(data.result);
            if (!checked.success || Object.entries(data.result).some(([key, value]) => key !== 'imageData' && secretPattern.test(JSON.stringify(value)))) {
              await finish(job, 'failed', 'OUTPUT_INVALID');
              return { accepted: true };
            }
            handlingResult = true;
            try {
              const result = await saveResult(workspace, job, checked.data);
              await finish(job, 'succeeded', undefined, result);
            } catch (error) {
              await finish(job, 'failed', error.code === 'OUTPUT_INVALID' ? error.code : 'RESULT_SAVE_FAILED');
            } finally {
              handlingResult = false;
            }
            return { accepted: true };
          }
          throw fail('NOT_FOUND', 'Unknown MCP connection route.', 404);
        });
        answer(res, 200, body);
      } catch (error) {
        answer(res, error.status ?? 500, {
          code: error.status ? error.code : 'BRIDGE_ERROR',
          message: error.status ? error.message : 'The local service could not save or process the request.',
        });
      }
    });
  }

  return {
    plugin: { name: 'furu-mcp-bridge', configurePreviewServer },
    stopIfIdle: () => ordered(async () => {
      await expireClient();
      if (current) return false;
      stopping = true;
      return true;
    }),
    connection: (url, replaceIdle) => ordered(async () => {
      await expireClient();
      if (client && !replaceIdle) return { connected: true, appUrl: url };
      if (current && replaceIdle) throw fail('APP_BUSY', 'Stop or finish the current job before switching applications.');
      pairing = { token: secret(), expiresAt: Date.now() + 600000, replaceIdle };
      return { connected: false, url: url + '#mcp=' + pairing.token, appUrl: url, expiresAt: new Date(pairing.expiresAt).toISOString() };
    }),
    status: () => ordered(async () => {
      await expireClient();
      return { ...identity, connected: Boolean(client), providerReady: client?.providerReady === true, operation, activeJob: current?.id ?? null };
    }),
    submit: (requestId, input) => ordered(async () => {
      await expireClient();
      const serialized = JSON.stringify(input);
    if (secretPattern.test(serialized)) throw fail('SECRET_IN_INPUT', 'Provider credentials belong in the normal application settings.', 400);
    const digest = hash(serialized);
      if (requestIds.has(requestId)) {
        const previous = get(requestIds.get(requestId));
        if (previous.digest !== digest) throw fail('REQUEST_CONFLICT', 'The same request ID was already used with different input.');
        return expose(previous);
      }
      if (stopping) throw fail('SERVICE_STOPPING', 'This service is shutting down.');
      if (!client) throw fail('APP_NOT_CONNECTED', 'Open the pairing URL in the in-app browser first.');
      if (current) throw fail('APP_BUSY', 'An application job is already active.');
      const job = { id: randomUUID(), app: identity.app, operation, requestId, digest, input, state: 'queued', createdAt: new Date().toISOString() };
      await persist(job);
      current = job;
      jobs.set(job.id, job);
      requestIds.set(requestId, job.id);
      return expose(job);
    }),
    get: id => ordered(async () => {
      await expireClient();
      return expose(get(id));
    }),
    cancel: id => ordered(async () => {
      await expireClient();
      const job = get(id);
      if (job.state === 'queued') return expose(await finish(job, 'cancelled', 'CANCELLED'));
      if (job.state === 'running') {
        const cancelling = { ...job, state: 'cancelling' };
        await persist(cancelling);
        current = cancelling;
        jobs.set(id, cancelling);
        return expose(cancelling);
      }
      return expose(job);
    }),
    close: () => ordered(async () => {
      try { await disconnect(); }
      finally { await unlock(); }
    }),
  };
}
