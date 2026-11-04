import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

// En desarrollo, /api se reenvía a la API local (node apps/api/src/server.js).
export default defineConfig({
  plugins: [preact()],
  server: { proxy: { '/api': 'http://localhost:3000' } },
});
