import { defineConfig } from 'vitest/config';

export default defineConfig({
  server: { port: 5173 },
  build: {
    // Phaser alone is ~1.2 MB; it gets its own long-cached chunk so game updates stay small.
    chunkSizeWarningLimit: 1400,
    rollupOptions: {
      output: {
        manualChunks: (id) => (id.includes('node_modules/phaser') ? 'phaser' : undefined),
      },
    },
  },
  test: { include: ['tests/**/*.test.ts'] },
});
