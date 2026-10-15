import { defineConfig } from 'vitest/config';

export default defineConfig({
  server: { port: 5173 },
  build: { chunkSizeWarningLimit: 2000 },
  test: { include: ['tests/**/*.test.ts'] },
});
