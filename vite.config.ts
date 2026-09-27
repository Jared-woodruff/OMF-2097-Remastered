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

export default defineConfig({
  // Relative base so the same build works on any web path and inside the desktop (Tauri) shell.
  base: './',
  plugins: [debugCapture()],
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    target: 'es2022',
    outDir: 'dist',
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 2000,
  },
});
