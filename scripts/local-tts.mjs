import { execFile, spawn } from 'node:child_process';
import { mkdir, open, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const origin = 'http://127.0.0.1:7789';
const version = '1.3.1';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const exists = async file => Boolean(await stat(file).catch(() => null));

async function healthy() {
  try {
    const response = await fetch(origin + '/v1/health', { signal: AbortSignal.timeout(1500) });
    return response.ok && (await response.json()).model === 'supertonic-3';
  } catch { return false; }
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const process = spawn(command, args, { stdio: 'inherit', windowsHide: true });
    process.once('error', reject);
    process.once('exit', code => code === 0 ? resolve() : reject(new Error(command + ' exited: ' + code)));
  });
}

async function voicevoxReady() {
  try {
    const res = await fetch('http://127.0.0.1:50021/version', { signal: AbortSignal.timeout(1500) });
    return res.ok && typeof await res.json() === 'string';
  } catch { return false; }
}

export async function prepareVoicevox() {
  if (await voicevoxReady()) return;
  if (process.platform !== 'win32') return;
  const found = await new Promise(resolve => {
    execFile('where.exe', ['VOICEVOX.exe'], { windowsHide: true }, (_, stdout) => resolve(stdout.trim().split(/\r?\n/)[0]));
  });
  if (!found || !path.isAbsolute(found)) return;
  const ui = await realpath(found);
  const executable = path.join(path.dirname(ui), 'vv-engine', 'run.exe');
  if (!await exists(executable) || await voicevoxReady()) return;
  const child = spawn(executable, ['--host', '127.0.0.1', '--port', '50021'], {
    cwd: path.dirname(executable), windowsHide: true, detached: true, stdio: 'ignore',
  });
  let failure;
  child.on('error', error => { failure = error; });
  child.once('exit', code => { if (code !== 0) failure = new Error('VOICEVOX startup failed (' + code + ').'); });
  child.unref();
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    if (await voicevoxReady()) return;
    if (failure) throw failure;
    await sleep(1500);
  }
  throw new Error('VOICEVOX did not respond on port 50021.');
}

export async function prepareSupertonic({ install = false } = {}) {
  if (await healthy()) return;
  if (process.platform !== 'win32' || !process.env.LOCALAPPDATA) {
    throw new Error('Start the local Supertonic service on port 7789.');
  }
  const root = path.join(process.env.LOCALAPPDATA, 'FURU Apps', 'ai-voice-comic-maker');
  const venv = path.join(root, 'supertonic-' + version, 'Scripts');
  const python = path.join(venv, 'python.exe');
  const executable = path.join(venv, 'supertonic.exe');
  if (!await exists(executable)) {
    if (!install) throw new Error('Run the Windows launcher once to prepare Supertonic.');
    await mkdir(root, { recursive: true });
    if (!await exists(python)) await run('python', ['-m', 'venv', path.dirname(venv)]);
    await run(python, ['-m', 'pip', 'install', '--disable-pip-version-check', '--index-url', 'https://pypi.org/simple', '--only-binary=:all:', 'supertonic[serve]==' + version]);
  }
  if (await healthy()) return;
  const shared = process.env.USERPROFILE && path.join(process.env.USERPROFILE, '.cache', 'supertonic3');
  const env = {
    ...process.env,
    SUPERTONIC_CACHE_DIR: process.env.SUPERTONIC_CACHE_DIR || (shared && await exists(shared) ? shared : path.join(root, 'supertonic-model')),
    HF_HOME: process.env.HF_HOME || path.join(root, 'supertonic-hub'),
  };
  const log = await open(path.join(root, 'supertonic.log'), 'a');
  let fault;
  try {
    const child = spawn(executable, ['serve', '--host', '127.0.0.1', '--port', '7789'], {
      env, detached: true, windowsHide: true, stdio: ['ignore', log.fd, log.fd],
    });
    child.on('error', error => { fault = error; });
    child.once('exit', code => { if (code !== 0) fault = new Error('Supertonic exited (' + code + '). See supertonic.log.'); });
    child.unref();
  } finally { await log.close(); }
  const deadline = Date.now() + 240_000;
  while (Date.now() < deadline) {
    if (await healthy()) return;
    if (fault) throw fault;
    await sleep(1500);
  }
  throw new Error('Supertonic was not ready after four minutes. See supertonic.log.');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await prepareSupertonic({ install: process.argv.includes('--install') });
    console.log('Supertonic 3 ready.');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
