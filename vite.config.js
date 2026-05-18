import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ command }) => ({
  plugins: [react()],
  base: command === 'build' ? '/ai-voice-comic-maker/' : '/',
  server: {
    port: 5174,
    strictPort: true,
    // バックエンドAPIへのプロキシ設定
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
  },
}));
