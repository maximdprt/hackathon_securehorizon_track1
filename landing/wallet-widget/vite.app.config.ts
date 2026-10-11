import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
// The app (landing/app.html): one IIFE, src/app.tsx, Privy and React included.
export default defineConfig({
  plugins: [react()],
  define: { 'process.env.NODE_ENV': '"production"' },
  build: {
    outDir: 'dist-app', emptyOutDir: true, cssCodeSplit: false,
    lib: { entry: 'src/app.tsx', formats: ['iife'], name: 'SentinelApp', fileName: () => 'sentinel-app.js' },
  },
});
