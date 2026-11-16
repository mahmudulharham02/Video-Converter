# WebFF Video Converter

A local-first, browser-based video converter built with HTML5, CSS3, and Vanilla JavaScript (ES modules). All media inspection, transcoding, and output verification execute locally inside WebAssembly and Web Workers—files never leave the user's device.

## Key Features

- **Hybrid Media Inspection**: Combines `mediainfo.js` (WASM chunked analyzer) and FFmpeg stream probing (`ffprobe` / `ffmpeg -i`) to inspect containers, video/audio/subtitle streams, resolution, SAR/DAR, rotation metadata, pixel format, frame rate, VFR/CFR timing, and bitrates—explicitly distinguishing missing, unknown, and undetermined fields from zero.
- **Dynamic Capability Filtering**: Queries the loaded FFmpeg.wasm core (`-encoders`, `-muxers`) at startup so only genuinely supported containers and encoders are offered.
- **Independent Job Configuration & Sequential Queue**: Each video is configured independently without inheriting settings from previous videos (unless explicitly copied by the user). Jobs are queued as immutable configuration snapshots, processed sequentially one at a time, and support editing pending jobs, reordering, removing, retrying failed/cancelled jobs, and real worker-termination cancellation.
- **Dynamic Command Generation & Output Verification**: Builds safe argument arrays (`ffmpeg.exec(args)`), mounts local `File` objects via `WORKERFS` where supported (avoiding full-file RAM duplication), cleans up virtual files immediately, and inspects every converted output before marking completion.
- **Threading Strategy**: Runs on a reliable single-thread WebAssembly baseline (`@ffmpeg/core`) and automatically upgrades to multithreaded WebAssembly (`@ffmpeg/core-mt`) when `SharedArrayBuffer` and `crossOriginIsolated` (`COOP`/`COEP`) are active.

## Technology Stack

- **Frontend**: HTML5, CSS3 (`prefers-color-scheme` + explicit theme toggle), Vanilla JavaScript ES modules
- **Conversion Engine**: `@ffmpeg/ffmpeg` (`0.12.x`), `@ffmpeg/core` (`0.12.x`), `@ffmpeg/core-mt` (`0.12.x`), `@ffmpeg/util`
- **Media Inspection**: `mediainfo.js` (`0.3.x`, WebAssembly)
- **Build Tooling**: Vite + `vite-plugin-static-copy` (self-hosting all JS, Worker, and `.wasm` assets with relative `./` base paths)

## Dependencies & Licensing Notes

- `@ffmpeg/ffmpeg`, `@ffmpeg/util`: MIT License.
- `mediainfo.js`: BSD-2-Clause License (MediaInfoLib).
- `@ffmpeg/core` / `@ffmpeg/core-mt`: FFmpeg WebAssembly builds bundle FFmpeg libraries (LGPL/GPL depending on included external codecs such as `libx264`, `libx265`, `libvpx`, `libopus`, `libmp3lame`, `libaom-av1`). Review the codec licenses included in `@ffmpeg/core` before distributing commercial products.

## Local Development

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Production Build & Local Production Preview

```bash
npm run lint
npm run build
npm run start
```

`npm run start` launches `server.mjs`, serving `dist/` with strict MIME types (`application/wasm` for `.wasm`), `Cross-Origin-Opener-Policy: same-origin`, and `Cross-Origin-Embedder-Policy: require-corp`.

## Deployment Instructions

All three hosting targets use the exact same portable `dist/` build:

### 1. Vercel
- Configuration file: `vercel.json`
- Build command: `npm run build`
- Output directory: `dist`
- Configured headers: `COOP: same-origin`, `COEP: require-corp`, `CORP: same-origin`, immutable caching on `/vendor/*`.

### 2. Netlify
- Configuration file: `netlify.toml`
- Build command: `npm run build`
- Publish directory: `dist`
- Configured headers: `COOP: same-origin`, `COEP: require-corp`, `CORP: same-origin`, explicit `application/wasm` MIME type on `/vendor/*.wasm`.

### 3. Railway
- Configuration files: `Dockerfile`, `server.mjs`, `.dockerignore`
- Build command: `npm run build`
- Start command: `npm start` (`node server.mjs`, automatically binding to `process.env.PORT`).

### Base-Path Portability
Vite is configured with `base: './'`, and all worker/WASM asset URLs resolve relative to `document.baseURI`, allowing deployment at root (`/`) or a static subpath (`/converter/`). Note that `COOP`/`COEP` headers must be served on the HTML document for multithreaded `@ffmpeg/core-mt`; otherwise the app automatically operates in single-thread mode.

## Browser Requirements & Known Limitations

- Requires modern WebAssembly and Web Workers (Chromium, Firefox, Safari 16.4+).
- **WASM Memory Ceiling**: Browser 32-bit WebAssembly has a ~2 GB address space limit. Although `WORKERFS` avoids copying input files into MEMFS where supported, encoded output files live in WASM memory before Blob creation. Files above 500 MB trigger a warning; files near or above 1.5 GB may fail due to browser memory limits.
- **Performance**: WebAssembly transcoding—especially `libx265`—is significantly slower than native desktop FFmpeg with hardware acceleration.
- **Codec Limitations**:
  - `@ffmpeg/core@0.12.10` / `@ffmpeg/core-mt@0.12.10` do not include `libaom-av1` or `libsvtav1` encoders, so AV1 encoding options are automatically excluded at runtime.
  - Although `libvpx-vp9` appears in `-encoders` of `@ffmpeg/core@0.12.10`, VP9 encoding crashes the WebAssembly runtime in browser tests; WebM output is therefore restricted to verified `libvpx` (VP8) video with `libopus` or `libvorbis` audio.
- **Pause/Resume**: FFmpeg.wasm does not support mid-encode pause/resume cleanly, so only real worker-terminating cancellation is provided.

## Testing Procedure

1. Run `npm run lint` and `npm run build` to verify syntax and bundle output (including `dist/vendor/ffmpeg*` and `dist/vendor/mediainfo`).
2. Serve the production build via `npm start`.
3. Verify in browser across desktop (`1440×900`) and mobile (`390×844` portrait and `844×390` landscape) viewports:
   - Engine loads in single-thread or multithread mode and populates detected encoders/muxers.
   - Selecting different videos inspects metadata accurately and keeps job configurations independent.
   - Editing, reordering, removing, cancelling, and retrying queue jobs preserves queue integrity.
   - Converted outputs pass verification checks and download cleanly.
