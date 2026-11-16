import { FFmpeg } from '@ffmpeg/ffmpeg';
import {
  detectBrowserCapabilities,
  parseFFmpegEncoders,
  parseFFmpegMuxers,
} from './capabilities.js';

function resolveAppAsset(relativePath) {
  return new URL(relativePath, document.baseURI).href;
}

function sanitizeExt(filename) {
  const match = /(\.[a-zA-Z0-9]{1,8})$/.exec(String(filename || ''));
  return match ? match[1].toLowerCase() : '.mp4';
}

export class FFmpegEngineClient {
  #ffmpeg = null;
  #loaded = false;
  #busy = false;
  #mode = null; // 'single' | 'multi'
  #fallbackReason = null;
  #capabilities = null;
  #encoders = { video: new Set(), audio: new Set(), subtitle: new Set(), descriptions: new Map() };
  #muxers = new Set();
  #muxerDescriptions = new Map();
  #cancelled = false;
  #initPromise = null;

  get isLoaded() {
    return this.#loaded;
  }

  get isBusy() {
    return this.#busy;
  }

  get activeMode() {
    return this.#mode;
  }

  get fallbackReason() {
    return this.#fallbackReason;
  }

  getCapabilitiesSnapshot() {
    return {
      ...(this.#capabilities || detectBrowserCapabilities()),
      activeMode: this.#mode,
      fallbackReason: this.#fallbackReason,
      encoders: this.#encoders,
      muxers: this.#muxers,
      muxerDescriptions: this.#muxerDescriptions,
    };
  }

  async init({ preferMultithread = true } = {}) {
    if (this.#loaded && this.#ffmpeg) {
      return this.getCapabilitiesSnapshot();
    }
    if (this.#initPromise) {
      return this.#initPromise;
    }

    this.#initPromise = (async () => {
      const browserCaps = detectBrowserCapabilities();
      this.#capabilities = browserCaps;

      if (!browserCaps.webAssembly || !browserCaps.workers) {
        throw new Error('Browser lacks WebAssembly or Web Worker support required for FFmpeg.wasm.');
      }

      const classWorkerURL = resolveAppAsset('vendor/ffmpeg/worker.js');
      const tryMulti = Boolean(preferMultithread && browserCaps.canMultithread);

      if (tryMulti) {
        try {
          const mtInstance = new FFmpeg();
          await mtInstance.load({
            classWorkerURL,
            coreURL: resolveAppAsset('vendor/ffmpeg-core-mt/ffmpeg-core.js'),
            wasmURL: resolveAppAsset('vendor/ffmpeg-core-mt/ffmpeg-core.wasm'),
            workerURL: resolveAppAsset('vendor/ffmpeg-core-mt/ffmpeg-core.worker.js'),
          });
          this.#ffmpeg = mtInstance;
          this.#mode = 'multi';
          this.#fallbackReason = null;
          this.#loaded = true;
        } catch (err) {
          this.#fallbackReason = `Multithreaded FFmpeg core failed to initialize (${err?.message || err}); using single-thread baseline.`;
        }
      }

      if (!this.#loaded) {
        const stInstance = new FFmpeg();
        await stInstance.load({
          classWorkerURL,
          coreURL: resolveAppAsset('vendor/ffmpeg-core/ffmpeg-core.js'),
          wasmURL: resolveAppAsset('vendor/ffmpeg-core/ffmpeg-core.wasm'),
        });
        this.#ffmpeg = stInstance;
        this.#mode = 'single';
        if (!this.#fallbackReason && !browserCaps.canMultithread) {
          this.#fallbackReason = 'Running in single-thread baseline (cross-origin isolation inactive).';
        }
        this.#loaded = true;
      }

      await this.#discoverSupportedFeatures();
      return this.getCapabilitiesSnapshot();
    })();

    try {
      return await this.#initPromise;
    } finally {
      this.#initPromise = null;
    }
  }

  async #discoverSupportedFeatures() {
    const encoderLines = [];
    const muxerLines = [];

    const captureEnc = ({ message }) => encoderLines.push(message);
    this.#ffmpeg.on('log', captureEnc);
    try {
      await this.#ffmpeg.exec(['-hide_banner', '-encoders']);
    } finally {
      this.#ffmpeg.off('log', captureEnc);
    }

    const captureMux = ({ message }) => muxerLines.push(message);
    this.#ffmpeg.on('log', captureMux);
    try {
      await this.#ffmpeg.exec(['-hide_banner', '-muxers']);
    } finally {
      this.#ffmpeg.off('log', captureMux);
    }

    this.#encoders = parseFFmpegEncoders(encoderLines);
    const parsedMuxers = parseFFmpegMuxers(muxerLines);
    this.#muxers = parsedMuxers.muxers;
    this.#muxerDescriptions = parsedMuxers.descriptions;
  }

  async #withMountedInput(fileOrBlob, ext, fn) {
    const uid = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const safeExt = ext || sanitizeExt(fileOrBlob?.name);
    const mountDir = `/mnt_${uid}`;
    const safeFileName = `input${safeExt}`;
    let mounted = false;
    let memfsInputPath = null;

    try {
      try {
        const aliasFile = new File([fileOrBlob], safeFileName, {
          type: fileOrBlob.type || 'application/octet-stream',
        });
        await this.#ffmpeg.createDir(mountDir);
        const ok = await this.#ffmpeg.mount('WORKERFS', { files: [aliasFile] }, mountDir);
        if (ok) {
          mounted = true;
          return await fn(`${mountDir}/${safeFileName}`);
        }
      } catch {
        // Fallback to MEMFS writeFile below
      }

      // Cleanup failed mount dir before fallback
      try {
        await this.#ffmpeg.deleteDir(mountDir);
      } catch {
        // ignore
      }

      memfsInputPath = `/mem_${uid}${safeExt}`;
      const buf = new Uint8Array(await fileOrBlob.arrayBuffer());
      await this.#ffmpeg.writeFile(memfsInputPath, buf);
      return await fn(memfsInputPath);
    } finally {
      if (mounted) {
        try {
          await this.#ffmpeg.unmount(mountDir);
        } catch {
          // ignore
        }
        try {
          await this.#ffmpeg.deleteDir(mountDir);
        } catch {
          // ignore
        }
      }
      if (memfsInputPath) {
        try {
          await this.#ffmpeg.deleteFile(memfsInputPath);
        } catch {
          // ignore
        }
      }
    }
  }

  /**
   * Probes streams and format using FFmpeg.wasm's ffprobe command (with `ffmpeg -i` fallback).
   */
  async probeStreams(fileOrBlob, extHint = '') {
    if (!this.#loaded) {
      await this.init();
    }
    if (this.#busy) {
      return null;
    }

    const ext = extHint || sanitizeExt(fileOrBlob?.name);
    const outJsonPath = `/probe_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.json`;

    try {
      return await this.#withMountedInput(fileOrBlob, ext, async (inputPath) => {
        try {
          const code = await this.#ffmpeg.ffprobe([
            '-v',
            'error',
            '-show_format',
            '-show_streams',
            '-of',
            'json',
            inputPath,
            '-o',
            outJsonPath,
          ]);
          if (code === 0) {
            const rawText = await this.#ffmpeg.readFile(outJsonPath, 'utf8');
            if (rawText && rawText.trim().startsWith('{')) {
              return { source: 'ffprobe', json: JSON.parse(rawText), logs: [] };
            }
          }
        } catch {
          // Fall through to `ffmpeg -i`
        } finally {
          try {
            await this.#ffmpeg.deleteFile(outJsonPath);
          } catch {
            // ignore
          }
        }

        const logs = [];
        const onLog = ({ message }) => logs.push(message);
        this.#ffmpeg.on('log', onLog);
        try {
          await this.#ffmpeg.exec(['-hide_banner', '-i', inputPath]);
        } catch {
          // `ffmpeg -i` without output exits with code 1 by design
        } finally {
          this.#ffmpeg.off('log', onLog);
        }
        return { source: 'ffmpeg-log', json: null, logs };
      });
    } catch {
      return null;
    }
  }

  /**
   * Executes a single video conversion job inside the worker.
   */
  async transcode({
    jobId,
    file,
    inputExt,
    outputExt,
    outputMime,
    buildArgs,
    onProgress,
    onLog,
  }) {
    if (!this.#loaded) {
      await this.init();
    }
    if (this.#busy) {
      throw new Error('FFmpeg engine is currently busy with another job.');
    }

    this.#busy = true;
    this.#cancelled = false;
    const outputVirtualPath = `/out_${jobId}${outputExt}`;
    const capturedLogs = [];

    const handleProgress = ({ progress, time }) => {
      if (this.#cancelled) return;
      const clamped = Number.isFinite(progress) ? Math.max(0, Math.min(1, progress)) : 0;
      onProgress?.({ progress: clamped, timeSec: Number.isFinite(time) ? time / 1_000_000 : null });
    };

    const handleLog = ({ type, message }) => {
      capturedLogs.push(message);
      if (capturedLogs.length > 250) capturedLogs.shift();
      onLog?.({ type, message });
    };

    this.#ffmpeg.on('progress', handleProgress);
    this.#ffmpeg.on('log', handleLog);

    try {
      return await this.#withMountedInput(file, inputExt, async (inputVirtualPath) => {
        const args = buildArgs(inputVirtualPath, outputVirtualPath);
        const exitCode = await this.#ffmpeg.exec(args);

        if (this.#cancelled) {
          throw new DOMException('Conversion was cancelled by user.', 'AbortError');
        }
        if (exitCode !== 0) {
          const tail = capturedLogs.slice(-6).join(' | ');
          throw new Error(`FFmpeg exited with status ${exitCode}${tail ? `: ${tail}` : ''}`);
        }

        const data = await this.#ffmpeg.readFile(outputVirtualPath);
        if (!(data instanceof Uint8Array) || data.byteLength === 0) {
          throw new Error('FFmpeg produced an empty output file.');
        }

        const blob = new Blob([data.buffer], { type: outputMime || 'application/octet-stream' });
        return { blob, args, logs: capturedLogs };
      });
    } finally {
      if (this.#ffmpeg) {
        this.#ffmpeg.off('progress', handleProgress);
        this.#ffmpeg.off('log', handleLog);
        try {
          await this.#ffmpeg.deleteFile(outputVirtualPath);
        } catch {
          // ignore if already removed or terminated
        }
      }
      this.#busy = false;
    }
  }

  /**
   * Terminates the running FFmpeg worker immediately to abort active encoding,
   * then resets state so the next queued job can cleanly reinitialize.
   */
  async cancelAndReset() {
    this.#cancelled = true;
    if (this.#ffmpeg) {
      try {
        this.#ffmpeg.terminate();
      } catch {
        // ignore
      }
    }
    this.#ffmpeg = null;
    this.#loaded = false;
    this.#busy = false;
    this.#mode = null;
  }
}
