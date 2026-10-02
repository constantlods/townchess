import { defineConfig } from 'vite';

export default defineConfig({
  server: { port: 5173, proxy: { '/ws': { target: 'ws://localhost:8787', ws: true } } },
  build: { target: 'es2022', chunkSizeWarningLimit: 2000 },
  worker: { format: 'es' },
});
