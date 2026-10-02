import { defineConfig } from 'vite';

export default defineConfig({
  // procedural assets are cached per build; a new build regenerates them once
  define: { __BUILD_ID__: JSON.stringify(Date.now().toString(36)) },
  server: { port: 5173, proxy: { '/ws': { target: 'ws://localhost:8787', ws: true } } },
  build: { target: 'es2022', chunkSizeWarningLimit: 2000 },
  worker: { format: 'es' },
});
