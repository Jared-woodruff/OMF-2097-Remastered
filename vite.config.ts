/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite';
import fs from 'node:fs';
import path from 'node:path';

/** Dev-only: lets the running game POST PNG captures to disk (used for automated visual checks). */
function debugCapture(): Plugin {
  return {
    name: 'omf-debug-capture',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__debug/capture', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end();
          return;
        }
        const name = String(new URL(req.url ?? '', 'http://x').searchParams.get('name') ?? 'capture').replace(/[^\w.-]/g, '_');
        const dir = process.env.OMF_CAPTURE_DIR ?? path.resolve('.captures');
        fs.mkdirSync(dir, { recursive: true });
        const chunks: Buffer[] = [];
        req.on('data', (c: Buffer) => chunks.push(c));
        req.on('end', () => {
          const file = path.join(dir, /\.(png|jpg)$/.test(name) ? name : `${name}.png`);
          fs.writeFileSync(file, Buffer.concat(chunks));
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ file }));
        });
      });
    },
  };
}

/** The version shown by the game (the main menu's corner, the loading screen). */
const VERSION = JSON.parse(fs.readFileSync(path.resolve('package.json'), 'utf8')).version as string;

export default defineConfig({
  // Relative base so the same build works on any web path and inside the desktop (Tauri) shell.
  base: './',
  define: { __APP_VERSION__: JSON.stringify(VERSION) },
  plugins: [debugCapture()],
  server: {
    port: 5173,
    strictPort: true,
    // Big generated and working folders (screen recordings, the art packs, the original game, the desktop build) are
    // not the app's source: watching their tens of thousands of files kept the dev server busy.
    watch: {
      ignored: ['**/.captures/**', '**/hd-pack/**', '**/newart-pack/**', '**/rework-pack/**', '**/menu-pack/**', '**/omf21cd/**', '**/src-tauri/target/**', '**/dist/**'],
    },
  },
  build: {
    target: 'es2022',
    outDir: 'dist',
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 2000,
  },
  test: {
    // The game logic runs against the real data: CI machines can be several times slower than a desktop.
    testTimeout: 15000,
  },
});
