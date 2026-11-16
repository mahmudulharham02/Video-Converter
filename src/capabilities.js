/**
 * Browser capability detection and live FFmpeg.wasm encoder/muxer parser.
 */

export const FILE_SIZE_WARN_BYTES = 500 * 1024 * 1024; // 500 MB
export const FILE_SIZE_HIGH_RISK_BYTES = 1500 * 1024 * 1024; // 1.5 GB (near 32-bit WASM heap ceiling)

export function detectBrowserCapabilities() {
  const webAssembly =
    typeof WebAssembly === 'object' &&
    typeof WebAssembly.instantiate === 'function';
  const workers = typeof Worker === 'function';
  const sharedArrayBuffer = typeof SharedArrayBuffer !== 'undefined';
  const crossOriginIsolated = Boolean(globalThis.crossOriginIsolated);
  const canMultithread = Boolean(
    webAssembly && workers && sharedArrayBuffer && crossOriginIsolated
  );

  const hardwareConcurrency =
    typeof navigator !== 'undefined' && typeof navigator.hardwareConcurrency === 'number'
      ? navigator.hardwareConcurrency
      : null;

  const deviceMemoryGb =
    typeof navigator !== 'undefined' && typeof navigator.deviceMemory === 'number'
      ? navigator.deviceMemory
      : null;

  const warnings = [];
  if (!webAssembly) {
    warnings.push('WebAssembly is unavailable in this browser. Video conversion cannot run.');
  }
  if (!workers) {
    warnings.push('Web Workers are unavailable in this browser. Processing cannot run off the main thread.');
  }
  if (!crossOriginIsolated || !sharedArrayBuffer) {
    warnings.push(
      'Cross-origin isolation (COOP/COEP) or SharedArrayBuffer is inactive; running in reliable single-thread WebAssembly mode.'
    );
  }

  return {
    webAssembly,
    workers,
    sharedArrayBuffer,
    crossOriginIsolated,
    canMultithread,
    hardwareConcurrency,
    deviceMemoryGb,
    warnings,
  };
}

/**
 * Parses `ffmpeg -encoders` output into separate video, audio, and subtitle encoder Sets.
 * Never mixes decoders with encoders.
 */
export function parseFFmpegEncoders(lines) {
  const video = new Set();
  const audio = new Set();
  const subtitle = new Set();
  const descriptions = new Map();

  // Format: " V..... libx264              libx264 H.264 / AVC / MPEG-4 AVC / MPEG-4 part 10 (codec h264)"
  const regex = /^\s*([VAS\.])([F\.])([S\.])([X\.])([B\.])([D\.])\s+([^\s]+)\s*(.*)$/;

  for (const rawLine of lines) {
    const line = String(rawLine || '');
    const match = regex.exec(line);
    if (!match) continue;
    const type = match[1];
    const name = match[7];
    const desc = match[8] || '';
    if (!name || name === '=') continue;
    descriptions.set(name, desc.trim());
    if (type === 'V') video.add(name);
    else if (type === 'A') audio.add(name);
    else if (type === 'S') subtitle.add(name);
  }

  return { video, audio, subtitle, descriptions };
}

/**
 * Parses `ffmpeg -muxers` output into a Set of muxer names that support encoding/muxing (`E`).
 */
export function parseFFmpegMuxers(lines) {
  const muxers = new Set();
  const descriptions = new Map();

  // Format: "  E mp4             MP4 (MPEG-4 Part 14)"
  const regex = /^\s*[D ]E\s+([^\s]+)\s*(.*)$/;

  for (const rawLine of lines) {
    const line = String(rawLine || '');
    const match = regex.exec(line);
    if (!match) continue;
    const name = match[1];
    const desc = match[2] || '';
    if (!name || name === '=') continue;
    muxers.add(name);
    descriptions.set(name, desc.trim());
  }

  return { muxers, descriptions };
}

export function evaluateFileMemoryRisk(fileSizeBytes, deviceMemoryGb) {
  if (!Number.isFinite(fileSizeBytes) || fileSizeBytes <= 0) {
    return { level: 'none', message: null };
  }
  if (fileSizeBytes >= FILE_SIZE_HIGH_RISK_BYTES) {
    return {
      level: 'danger',
      message:
        'File exceeds 1.5 GB. Browser 32-bit WebAssembly memory (~2 GB ceiling) may run out of memory while muxing output.',
    };
  }
  if (fileSizeBytes >= FILE_SIZE_WARN_BYTES) {
    const ramHint = deviceMemoryGb ? ` (reported device RAM: ~${deviceMemoryGb} GB)` : '';
    return {
      level: 'warning',
      message: `Large file (>500 MB)${ramHint}. Processing runs sequentially in browser memory; close heavy tabs if allocation fails.`,
    };
  }
  return { level: 'none', message: null };
}
