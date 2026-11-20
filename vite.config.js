import { furuMcpBuild } from './mcp/build.mjs';
import { webSecurity } from './scripts/web-security.mjs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'node:path';

function publicBuildAllowlist() {
  let projectRoot;
  return {
    name: 'public-build-allowlist',
    configResolved(config) { projectRoot = config.root; },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const pathname = (req.url || '').split('?')[0];
        if (!['/downloads/short-movie-manual.pdf', '/downloads/short-movie-api-guide.pdf', '/downloads/ai-voice-comic-maker-mcp-guide.html'].includes(pathname)) return next();
        const file = path.join(projectRoot, 'public', pathname.slice(1));
        if (!fs.existsSync(file)) { res.statusCode = 404; res.end('Manual not found'); return; }
        res.setHeader('Content-Type', pathname.endsWith('.pdf') ? 'application/pdf' : 'text/html; charset=utf-8');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        fs.createReadStream(file).pipe(res);
      });
    },
    generateBundle() {
      for (const name of ['short-movie-manual.pdf', 'short-movie-api-guide.pdf', 'ai-voice-comic-maker-mcp-guide.html']) {
        this.emitFile({ type: 'asset', fileName: 'downloads/' + name, source: fs.readFileSync(path.join(projectRoot, 'public', 'downloads', name)) });
      }
      this.emitFile({ type: 'asset', fileName: '.nojekyll', source: '' });
      const licensePath = path.join(projectRoot, 'public', 'LICENSE.txt');
      if (fs.existsSync(licensePath)) {
        this.emitFile({ type: 'asset', fileName: 'LICENSE.txt', source: fs.readFileSync(licensePath) });
      }
    },
  };
}

export default defineConfig(({ command, isPreview }) => ({
  plugins: [webSecurity({ connectSources: [] }), furuMcpBuild("ai-voice-comic-maker", 45935), react(), publicBuildAllowlist()],
  // Legacy public runtime files stay on disk, but are never served or copied.
  publicDir: false,
  base: command === 'build' || isPreview ? '/ai-voice-comic-maker/' : '/',
  server: {
    host: '127.0.0.1',
    port: 5174,
    strictPort: true,
    fs: {
      deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/.runtime/**',
        '**/temp/**', '**/out/**', '**/public/panels/**', '**/public/voiceover/**', '**/public/audio/**'],
    },
    // バックエンドAPIへのプロキシ設定
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3001',
        changeOrigin: true,
      },
    },
  },
  preview: { host: '127.0.0.1' },
  build: {
    outDir: 'dist',
  },
}));
