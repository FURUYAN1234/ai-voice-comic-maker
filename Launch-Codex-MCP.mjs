import { lstat, readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const source = fileURLToPath(new URL('./', import.meta.url));
const config = JSON.parse(await readFile(path.join(source, 'mcp', 'launcher.json'), 'utf8'));
if (!/^[a-z0-9-]+$/.test(config.id)) throw new Error('Invalid launcher application ID.');
const install = path.join(process.env.LOCALAPPDATA || os.homedir(), 'FURU Apps', config.id);
const pointer = path.join(install, 'active.json');

async function activeSource() {
  let record;
  try {
    if (!(await lstat(pointer)).isFile()) throw new Error('The application pointer must be a regular file.');
    record = JSON.parse(await readFile(pointer, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return source;
    throw error;
  }
  if (record.app !== config.id || !/^v\d+\.\d+\.\d+-[0-9a-f]{40}$/.test(record.directory)) throw new Error('Invalid managed app pointer.');
  const root = path.join(install, 'versions', record.directory);
  if (!(await lstat(root)).isDirectory() || (await lstat(root)).isSymbolicLink()) throw new Error('The managed app is not a regular directory.');
  const app = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  if (app.name !== config.package || app.version !== record.version) throw new Error('The managed app does not match the update record.');
  return root;
}

const root = await activeSource();
const child = spawn(process.execPath, [path.join(root, 'mcp', 'server.mjs'), ...process.argv.slice(2)], {
  cwd: root, windowsHide: true, stdio: 'inherit',
});
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => child.kill(signal));
const [code] = await once(child, 'exit');
process.exitCode = code ?? 1;
