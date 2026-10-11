import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  define: { 'process.env.NODE_ENV': '"production"' },
  build: {
    outDir: 'dist', emptyOutDir: true, cssCodeSplit: false,
    lib: { entry: 'src/main.tsx', formats: ['iife'], name: 'SentinelAuth', fileName: () => 'sentinel-auth.js' },
  },
});
