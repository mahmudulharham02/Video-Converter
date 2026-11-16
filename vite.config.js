import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { viteStaticCopy } from 'vite-plugin-static-copy';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const isolationHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Resource-Policy': 'same-origin',
};

export default defineConfig(() => ({
  base: './',
  plugins: [
    viteStaticCopy({
      targets: [
        {
          src: 'node_modules/@ffmpeg/core/dist/esm/*',
          dest: 'vendor/ffmpeg-core',
          rename: { stripBase: true },
        },
        {
          src: 'node_modules/@ffmpeg/core-mt/dist/esm/*',
          dest: 'vendor/ffmpeg-core-mt',
          rename: { stripBase: true },
        },
        {
          src: [
            'node_modules/@ffmpeg/ffmpeg/dist/esm/worker.js',
            'node_modules/@ffmpeg/ffmpeg/dist/esm/const.js',
            'node_modules/@ffmpeg/ffmpeg/dist/esm/errors.js',
          ],
          dest: 'vendor/ffmpeg',
          rename: { stripBase: true },
        },
        {
          src: 'node_modules/mediainfo.js/dist/MediaInfoModule.wasm',
          dest: 'vendor/mediainfo',
          rename: { stripBase: true },
        },
      ],
    }),
  ],
  optimizeDeps: {
    exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util', '@ffmpeg/core', '@ffmpeg/core-mt'],
  },
  worker: {
    format: 'es',
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
  },
  server: {
    port: 3000,
    host: '0.0.0.0',
    headers: isolationHeaders,
    hmr: process.env.DISABLE_HMR !== 'true',
    watch: process.env.DISABLE_HMR === 'true' ? null : {},
  },
  preview: {
    port: 3000,
    host: '0.0.0.0',
    headers: isolationHeaders,
  },
}));
