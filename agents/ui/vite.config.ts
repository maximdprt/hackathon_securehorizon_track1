import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// `npm run dev` : l'interface sur le port de Vite, les appels /api et /site relayés vers agents/app.py.
// `npm run build` : écrit dist/, que agents/app.py sert tel quel.
export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/api': 'http://127.0.0.1:8765', '/site': 'http://127.0.0.1:8765' } },
  test: { environment: 'jsdom', globals: true, setupFiles: './src/test/setup.ts' },
});
