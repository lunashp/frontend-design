import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * The web app talks to @ce/host over HTTP/WS only (never imports the engine),
 * so we proxy /api and /ws to the local host server in dev.
 */
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:4317',
      '/ws': { target: 'ws://localhost:4317', ws: true },
    },
  },
});
