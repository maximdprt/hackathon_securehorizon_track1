import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
// Sentinel Ops (landing/ops.html): one IIFE, src/ops.tsx.
export default defineConfig({
  plugins: [react()],
  define: { 'process.env.NODE_ENV': '"production"' },
  build: {
    outDir: 'dist-ops', emptyOutDir: true, cssCodeSplit: false,
    lib: { entry: 'src/ops.tsx', formats: ['iife'], name: 'SentinelOps', fileName: () => 'sentinel-ops.js' },
  },
});
