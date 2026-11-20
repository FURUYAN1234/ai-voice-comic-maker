import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { makeSkillArchive } from './skill-archive.mjs';

const stampName = 'furu-mcp-build.json';

async function treeHash(root, inputs, ignore = new Set()) {
  const hash = createHash('sha256');
  async function visit(name) {
    if (ignore.has(name)) return;
    const file = path.join(root, name);
    const entries = await readdir(file, { withFileTypes: true }).catch(error => {
      if (error.code !== 'ENOTDIR') throw error;
      return null;
    });
    if (entries === null) {
      const bytes = await readFile(file);
      hash.update(JSON.stringify([name, bytes.length]));
      hash.update(bytes);
      return;
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
      if (entry.isSymbolicLink()) throw new Error('Build inputs must not contain symbolic links.');
      await visit(path.posix.join(name, entry.name));
    }
  }
  for (const name of inputs) await visit(name);
  return hash.digest('hex');
}

export async function sourceIdentity(root, app) {
  const { version } = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  const roots = await readdir(root);
  const extras = ['server', 'scripts', 'server.js', 'local-security.js', 'local-render.js', 'runtime-paths.js', 'image-upload.js', 'openai-chat-contract.js'].filter(name => roots.includes(name));
  const source = await treeHash(root, ['index.html', 'package.json', 'package-lock.json', 'vite.config.js', 'src', 'public', 'mcp', ...extras], new Set(['mcp/node_modules']));
  return { app, version, contract: 1, source };
}

export async function verifyMcpBuild(root, app, dist = path.join(root, 'dist')) {
  const expected = await sourceIdentity(root, app);
  const stamp = JSON.parse(await readFile(path.join(dist, stampName), 'utf8'));
  const files = (await readdir(dist)).filter(name => name !== stampName).sort();
  const actual = await treeHash(dist, files);
  if (stamp.app !== expected.app || stamp.version !== expected.version || stamp.contract !== expected.contract || stamp.source !== expected.source || stamp.dist !== actual || !files.includes('index.html')) {
    throw new Error('BUILD_MISMATCH: Run npm run build in the target application.');
  }
  return expected;
}

export function furuMcpBuild(app, connectionPort) {
  let config;
  let identity;
  const archive = 'downloads/' + app + '-mcp-skill.zip';
  return {
    name: 'furu-mcp-build',
    async config(userConfig, env) {
      if (env.command !== 'build') return;
      identity = await sourceIdentity(path.resolve(userConfig.root ?? process.cwd()), app);
      return { define: { __FURU_MCP_IDENTITY__: JSON.stringify({ ...identity, connectionPort }) } };
    },
    configResolved(value) {
      config = value;
    },
    async generateBundle() {
      this.emitFile({ type: 'asset', fileName: archive, source: await makeSkillArchive(config.root) });
    },
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (req.method !== 'GET' || req.url?.split('?')[0] !== server.config.base + archive) return next();
        try {
          const contents = await makeSkillArchive(config.root);
          res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Length': contents.length });
          res.end(contents);
        } catch (error) {
          next(error);
        }
      });
    },
    async closeBundle() {
      if (config.command !== 'build' || !config.build.write) return;
      const dist = path.resolve(config.root, config.build.outDir);
      const files = (await readdir(dist)).filter(name => name !== stampName).sort();
      if (!files.includes('index.html')) throw new Error('MCP build did not emit index.html.');
      const distHash = await treeHash(dist, files);
      await writeFile(path.join(dist, stampName), JSON.stringify({ ...identity, dist: distHash }) + '\n');
    },
  };
}
