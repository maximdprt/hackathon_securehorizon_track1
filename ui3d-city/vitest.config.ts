import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// as builders-hub's vitest.config.ts: the `@` alias at the project root
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('.', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts'],
  },
});
