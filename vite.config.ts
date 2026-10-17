import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

const PHASER_SRC = fileURLToPath(new URL('./node_modules/phaser/src/', import.meta.url)).replaceAll('\\', '/');

/** The feature switches Phaser's own dist build bakes in (see phaser/config/webpack.dist.config.js). */
const PHASER_FLAGS: Record<string, boolean> = {
  CANVAS_RENDERER: true,
  WEBGL_RENDERER: true,
  WEBGL_DEBUG: false,
  EXPERIMENTAL: false,
  PLUGIN_3D: false,
  PLUGIN_CAMERA3D: false,
  PLUGIN_FBINSTANT: false,
  FEATURE_SOUND: true,
};

/**
 * Production builds bundle Phaser from its source without the Arcade and Matter physics engines, which a game of
 * tile-grid ships never uses. Dev keeps the prebuilt bundle, which has them, so do not reach for Phaser.Physics.
 */
function phaserWithoutPhysics(): Plugin {
  return {
    name: 'phaser-without-physics',
    apply: 'build',
    enforce: 'pre',
    resolveId(id) {
      if (id === 'phaser') return `${PHASER_SRC}phaser.js`;
    },
    transform(code, id) {
      const file = id.replaceAll('\\', '/');
      if (!file.startsWith(PHASER_SRC)) return;
      let out = code.replace(/typeof (\w+)/g, (all, name: string) => (name in PHASER_FLAGS ? String(PHASER_FLAGS[name]) : all));
      if (file === `${PHASER_SRC}phaser.js`) out = out.replace("Physics: require('./physics'),", '').replace('global.Phaser = Phaser;', '');
      return out === code ? undefined : { code: out, map: null };
    },
  };
}

export default defineConfig({
  plugins: [phaserWithoutPhysics()],
  // host: true listens on every network interface so other devices on the LAN can play.
  server: { port: 5173, host: true },
  preview: { host: true },
  build: {
    // Phaser alone is ~1 MB; it gets its own long-cached chunk so game updates stay small.
    chunkSizeWarningLimit: 1400,
    rollupOptions: {
      output: {
        manualChunks: (id) => (id.includes('node_modules/phaser') ? 'phaser' : undefined),
      },
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    // `npm run coverage`: the simulation and its data are what the tests can reach (scenes need a browser).
    coverage: { provider: 'v8', include: ['src/sim/**', 'src/data/**', 'src/scenes/save.ts'], reporter: ['text', 'text-summary'] },
  },
});
