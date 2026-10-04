import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'node:path';

function publicBuildAllowlist() {
  let projectRoot;
  return {
    name: 'public-build-allowlist',
    configResolved(config) { projectRoot = config.root; },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: '.nojekyll', source: '' });
      const licensePath = path.join(projectRoot, 'public', 'LICENSE.txt');
      if (fs.existsSync(licensePath)) {
        this.emitFile({ type: 'asset', fileName: 'LICENSE.txt', source: fs.readFileSync(licensePath) });
      }
    },
  };
}

export default defineConfig(({ command }) => ({
  plugins: [react(), publicBuildAllowlist()],
  // Legacy public runtime files stay on disk, but are never served or copied.
  publicDir: false,
  base: command === 'build' ? '/ai-voice-comic-maker/' : '/',
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
