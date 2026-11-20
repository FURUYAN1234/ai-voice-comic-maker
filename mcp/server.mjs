import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { createMcpHandler, McpServer, Server } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { toNodeHandler } from '@modelcontextprotocol/node';
import * as z from 'zod/v4';
import { preview } from 'vite';
import { fork, spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { lstat, mkdir, open, readFile, realpath, rename, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyMcpBuild } from './build.mjs';
import { createBridge } from './bridge.mjs';
import { prepareSupertonic, prepareVoicevox } from '../scripts/local-tts.mjs';
import { app, prefix, port, operation, input, output, description } from './app.mjs';

const program = fileURLToPath(import.meta.url);
const root = fileURLToPath(new URL('../', import.meta.url));
const flag = process.argv.indexOf('--workspace');
const directory = flag < 0 ? path.join(process.env.LOCALAPPDATA || os.homedir(), 'FURU MCP', app) : process.argv[flag + 1];
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const render = (value, isError = false) => ({
  content: [{ type: 'text', text: JSON.stringify(value) }],
  ...(isError ? { isError } : { structuredContent: value }),
});
const serverRoute = (appUrl, route) => new URL('./__furu_mcp__/' + route, appUrl);
const match = (a, b) => ['app', 'version', 'contract', 'source'].every(key => a[key] === b[key]);

function createApplicationMcp(identity, bridge, appUrl) {
  const server = new McpServer({ name: app, version: identity.version });
  const jobId = z.string().uuid();
  const empty = z.object({}).strict();
  const register = (name, help, inputSchema, handler, readOnlyHint = false) => {
    server.registerTool(prefix + '_' + name, { description: help, inputSchema, annotations: { readOnlyHint } }, async args => {
      try { return render(await handler(args)); }
      catch (error) {
        return render({ code: error.status ? error.code : 'LOCAL_SERVICE_ERROR', message: error.status ? error.message : 'The local service could not complete this operation.' }, true);
      }
    });
  };
  register('capabilities', 'Read the current app, build, connection and operation. No provider call.', empty, bridge.status, true);
  register('connection', 'Open the returned local URL in the Codex in-app browser. The one-time pairing activates automatically. Never persist the pairing fragment. If the AI cannot establish it, ask the user to open the target app.',
    z.object({ replaceIdle: z.boolean().optional() }).strict(), ({ replaceIdle }) => bridge.connection(appUrl(), replaceIdle === true));
  register(operation, description, z.object({ requestId: z.string().min(1).max(128), input }).strict(), ({ requestId, input: payload }) => bridge.submit(requestId, payload));
  register('job_get', 'Read job status and validated output. Unknown means that the provider might have executed. Check the app before retrying.',
    z.object({ jobId }).strict(), ({ jobId }) => bridge.get(jobId), true);
  register('job_cancel', 'Stop a queued job or request the existing emergency-stop operation. Poll job_get for confirmation.',
    z.object({ jobId }).strict(), ({ jobId }) => bridge.cancel(jobId));
  return server;
}

async function startService(workspace, recordFile, identity) {
  const instance = { ...identity, workspace, instanceId: randomUUID(), pid: process.pid };
  const token = randomBytes(32).toString('base64url');
  let appUrl;
  let previewServer;
  let backend;
  let closing;
  const close = () => closing ??= (async () => {
    try {
      await previewServer?.close();
      const record = JSON.parse(await readFile(recordFile, 'utf8').catch(error => {
        if (error.code === 'ENOENT') return 'null';
        throw error;
      }));
      if (record?.instanceId === instance.instanceId) await unlink(recordFile);
    } finally {
      if (backend && backend.exitCode === null && backend.signalCode === null) backend.kill();
      await bridge.close();
    }
  })();
  const bridge = await createBridge({
    identity, operation, output, directory: workspace,
    service: {
      token,
      health: async () => ({ ...instance, ...await bridge.status(), appUrl }),
      stop: async () => {
        if (!await bridge.stopIfIdle()) return false;
        setImmediate(() => { void close().catch(error => process.stderr.write(error.message + '\n')); });
        return true;
      },
      handle: toNodeHandler(createMcpHandler(() => createApplicationMcp(identity, bridge, () => appUrl))),
    },
  });
  try {
    if (process.platform === 'win32') {
      void prepareSupertonic().catch(error => process.stderr.write('Supertonic: ' + error.message + '\n'));
      void prepareVoicevox().catch(error => process.stderr.write('VOICEVOX: ' + error.message + '\n'));
    }
    const backendPort = 45938;
    backend = fork(path.join(root, 'server.js'), ['--furu-mcp-backend'], {
      cwd: root, windowsHide: true, stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
    });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('The local video backend did not become ready.')), 15_000);
      const done = error => {
        clearTimeout(timer);
        if (error) reject(error);
        else resolve();
      };
      backend.once('error', done);
      backend.once('exit', code => done(new Error('The local video backend exited (' + code + ').')));
      backend.once('message', message => {
        if (message?.type !== 'voice-comic-ready' || message.port !== backendPort) {
          done(new Error('The local video backend did not match this MCP application.'));
        } else done();
      });
    });
    previewServer = await preview({
      root,
      logLevel: 'silent',
      configFile: path.join(root, 'vite.config.js'),
      preview: { host: '127.0.0.1', port, strictPort: true, open: false, cors: false, proxy: { '/api': { target: 'http://127.0.0.1:' + backendPort, changeOrigin: true } } },
      plugins: [bridge.plugin],
    });
    appUrl = 'http://127.0.0.1:' + port + previewServer.config.base;
    const temp = recordFile + '.' + instance.instanceId + '.tmp';
    await writeFile(temp, JSON.stringify({ ...instance, appUrl, token }) + '\n', { mode: 0o600, flag: 'wx' });
    await rename(temp, recordFile);
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void close().finally(() => process.exit(0)); });
    process.stderr.write('Local FURU MCP service ready on port ' + port + '\n');
  } catch (error) {
    await close();
    throw error;
  }
}

async function readService(recordFile, workspace) {
  let recordText;
  try {
    if (!(await lstat(recordFile)).isFile()) throw new Error('The workspace owner record must be a regular file.');
    recordText = await readFile(recordFile, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  const record = JSON.parse(recordText);
  const url = new URL(record.appUrl);
  if (url.origin !== 'http://127.0.0.1:' + port || url.username || url.password || url.search || url.hash || !url.pathname.endsWith('/')
    || record.app !== app || record.workspace !== workspace || record.contract !== 1 || !/^[A-Za-z0-9_-]{43}$/.test(record.token)) {
    throw new Error('The saved service identity does not belong to this app and workspace.');
  }
  const headers = { Authorization: 'Bearer ' + record.token };
  let response;
  try { response = await fetch(serverRoute(record.appUrl, 'health'), { headers, signal: AbortSignal.timeout(1800) }); }
  catch { return null; }
  if (!response.ok) return null;
  const health = await response.json();
  if (!match(record, health) || health.instanceId !== record.instanceId || health.pid !== record.pid || health.workspace !== workspace || health.appUrl !== record.appUrl) throw new Error('The running MCP service does not match the workspace owner.');
  return { record, headers };
}

async function ensureService(workspace, recordFile, identity) {
  const existing = await readService(recordFile, workspace);
  if (existing) return existing;
  const log = await open(path.join(workspace, 'service.log'), 'a', 0o600);
  try {
    const child = spawn(process.execPath, [program, '--service', '--workspace', workspace], {
      cwd: root, detached: true, windowsHide: true, stdio: ['ignore', 'ignore', log.fd],
    });
    child.on('error', () => {});
    child.unref();
  } finally { await log.close(); }
  for (let i = 0; i < 50; i += 1) {
    await delay(200);
    const service = await readService(recordFile, workspace);
    if (service) return service;
  }
  throw new Error('The local MCP service did not start. Check that port ' + port + ' is free and review service.log in this workspace.');
}

async function runAdapter(workspace, recordFile, identity) {
  const checkBuild = service => {
    if (!match(service.record, identity)) throw new Error('BUILD_MISMATCH: Stop the previous idle service with --stop, then reconnect this client.');
    return service;
  };
  checkBuild(await ensureService(workspace, recordFile, identity));
  const server = new Server({ name: app + '-local-adapter', version: identity.version }, { capabilities: { tools: {} } });
  function forward(method, invoke) {
    server.setRequestHandler(method, async request => {
      const { record, headers } = checkBuild(await ensureService(workspace, recordFile, identity));
      const client = new Client({ name: app + '-stdio', version: identity.version });
      await client.connect(new StreamableHTTPClientTransport(serverRoute(record.appUrl, 'server'), { requestInit: { headers } }));
      try { return await invoke(client, request.params); }
      finally { await client.close(); }
    });
  }
  forward('tools/list', (client, params) => client.listTools(params));
  forward('tools/call', (client, params) => client.callTool(params));
  await server.connect(new StdioServerTransport());
}

try {
  if (!directory || !path.isAbsolute(directory)) throw new Error('Use an absolute --workspace path.');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const workspace = await realpath(directory);
  const record = path.join(workspace, 'local-service.json');
  if (process.argv.includes('--stop')) {
    const service = await readService(record, workspace);
    if (service) {
      const res = await fetch(serverRoute(service.record.appUrl, 'stop'), { method: 'POST', headers: service.headers, signal: AbortSignal.timeout(5000) });
      if (!res.ok) throw new Error('Finish or stop the active job before stopping the local service.');
      for (let i = 0; i < 25 && await readService(record, workspace); i += 1) await delay(200);
      if (await readService(record, workspace)) throw new Error('The local service has not stopped.');
    }
  } else {
    const identity = await verifyMcpBuild(root, app);
    if (process.argv.includes('--service')) await startService(workspace, record, identity);
    else if (process.argv.includes('--launch')) {
      const service = await ensureService(workspace, record, identity);
      if (!match(service.record, identity)) throw new Error('BUILD_MISMATCH: Stop the previous idle service with --stop, then launch again.');
      process.stdout.write(service.record.appUrl + '\n');
    } else await runAdapter(workspace, record, identity);
  }
} catch (error) {
  process.stderr.write('FURU MCP startup: ' + error.message + '\n');
  process.exitCode = 1;
}
