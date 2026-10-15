import { defineConfig } from 'vitest/config';

export default defineConfig({
  // host: true listens on every network interface so other devices on the LAN can play.
  server: { port: 5173, host: true },
  preview: { host: true },
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
