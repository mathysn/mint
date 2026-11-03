import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  root: 'web',
  envDir: '..',
  plugins: [react()],
  build: { outDir: '../dist', emptyOutDir: true },
  server: {
    port: 5173,
    // The API runs on :3000 locally (pnpm dev:api); on Vercel it is the same origin.
    proxy: { '/api': 'http://localhost:3000' },
  },
});
