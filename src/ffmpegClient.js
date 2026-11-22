import { FFmpeg } from '@ffmpeg/ffmpeg';
import {
  detectBrowserCapabilities,
  parseFFmpegEncoders,
  parseFFmpegMuxers,
} from './capabilities.js';

const MEMFS_DIRECT_LIMIT_BYTES = 64 * 1024 * 1024; // 64 MB: deterministic across mobile File handles
const MT_LOAD_TIMEOUT_MS = 25000;
const ST_LOAD_TIMEOUT_MS = 45000;
const FEATURE_PROBE_TIMEOUT_MS = 15000;

function resolveAppAsset(relativePath) {
  return new URL(relativePath, document.baseURI).href;
}

function sanitizeExt(filename) {
  const match = /(\.[a-zA-Z0-9]{1,8})$/.exec(String(filename || ''));
  return match ? match[1].toLowerCase() : '.mp4';
}

function withTimeout(promise, timeoutMs, label, onTimeout) {
  let timerId = null;
  const timeoutPromise = new Promise((_, reject) => {
    timerId = setTimeout(() => {
      try {
        onTimeout?.();
      } catch {
        // ignore cleanup error
      }
      reject(new Error(`${label} timed out after ${Math.round(timeoutMs / 1000)}s.`));
    }, timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timerId !== null) {
      clearTimeout(timerId);
    }
  });
}

function isRuntimeRecoverableMtError(err) {
  const msg = String(err?.message || err || '').toLowerCase();
  return (
    msg.includes('out of memory') ||
    msg.includes('memory') ||
    msg.includes('pthread') ||
    msg.includes('sharedarraybuffer') ||
    msg.includes('aborted') ||
    msg.includes('timed out') ||
    msg.includes('worker') ||
    msg.includes('terminated')
  );
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
  #diagnosticHandler = null;
  #forceSingleThread = false;

  setDiagnosticHandler(handler) {
    this.#diagnosticHandler = typeof handler === 'function' ? handler : null;
  }

  #emit(stage, message, level = 'info') {
    const entry = {
      timestamp: Date.now(),
      stage,
      message,
      level,
    };
    const logFn =
      level === 'error' ? console.error : level === 'warn' ? console.warn : console.info;
    logFn(`[WebFF:${stage}] ${message}`);
    try {
      this.#diagnosticHandler?.(entry);
    } catch {
      // ignore diagnostic sink errors
    }
  }

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

  async #verifyAsset(url, stageKey, assetLabel) {
    let res;
    try {
      res = await withTimeout(
        fetch(url, { method: 'HEAD', credentials: 'same-origin' }),
        10000,
        `${assetLabel} check`
      );
      if (res.status === 405) {
        res = await withTimeout(
          fetch(url, {
            method: 'GET',
            headers: { Range: 'bytes=0-15' },
            credentials: 'same-origin',
          }),
          10000,
          `${assetLabel} check`
        );
      }
    } catch (err) {
      const msg = `${assetLabel} failed (${url}): ${err?.message || err}`;
      this.#emit(stageKey, msg, 'error');
      throw new Error(msg);
    }

    if (!res.ok) {
      const msg = `${assetLabel} failed with HTTP ${res.status} (${url}).`;
      this.#emit(stageKey, msg, 'error');
      throw new Error(msg);
    }

    const contentType = (res.headers.get('content-type') || '').toLowerCase();
    if (contentType.includes('text/html')) {
      const msg = `${assetLabel} failed: server returned text/html instead of asset (${url}).`;
      this.#emit(stageKey, msg, 'error');
      throw new Error(msg);
    }

    this.#emit(
      stageKey,
      `Verified ${assetLabel} (${res.status}, ${contentType || 'no content-type'})`
    );
  }

  async #loadCoreInstance({ classWorkerURL, coreURL, wasmURL, workerURL = null, timeoutMs, label }) {
    await this.#verifyAsset(classWorkerURL, 'worker_loading', 'Worker script');
    await this.#verifyAsset(coreURL, 'core_js_loading', 'Core JavaScript');
    await this.#verifyAsset(wasmURL, 'wasm_loading', 'WASM binary');
    if (workerURL) {
      await this.#verifyAsset(workerURL, 'worker_loading', 'Pthread worker script');
    }

    const instance = new FFmpeg();
    const loadConfig = workerURL
      ? { classWorkerURL, coreURL, wasmURL, workerURL }
      : { classWorkerURL, coreURL, wasmURL };

    try {
      await withTimeout(
        instance.load(loadConfig),
        timeoutMs,
        `${label} load`,
        () => instance.terminate()
      );
      return instance;
    } catch (err) {
      try {
        instance.terminate();
      } catch {
        // ignore termination cleanup failure
      }
      throw err;
    }
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
      this.#emit(
        'ffmpeg_init_started',
        `Init requested (crossOriginIsolated=${browserCaps.crossOriginIsolated}, SAB=${browserCaps.sharedArrayBuffer}, mobile=${browserCaps.isMobile}, safeMT=${browserCaps.safeMultithread})`
      );

      if (!browserCaps.webAssembly || !browserCaps.workers) {
        const msg = 'Browser lacks WebAssembly or Web Worker support required for FFmpeg.wasm.';
        this.#emit('ffmpeg_init_failed', msg, 'error');
        throw new Error(msg);
      }

      const classWorkerURL = resolveAppAsset('vendor/ffmpeg/worker.js');
      const tryMulti = Boolean(
        preferMultithread && !this.#forceSingleThread && browserCaps.safeMultithread
      );

      if (preferMultithread && browserCaps.canMultithread && !browserCaps.safeMultithread) {
        this.#fallbackReason = browserCaps.multithreadSkipReason;
        this.#emit('ffmpeg_fallback_single_thread', this.#fallbackReason);
      }

      if (tryMulti) {
        try {
          this.#emit('ffmpeg_init_started', 'Attempting multithreaded FFmpeg.wasm core');
          const mtInstance = await this.#loadCoreInstance({
            classWorkerURL,
            coreURL: resolveAppAsset('vendor/ffmpeg-core-mt/ffmpeg-core.js'),
            wasmURL: resolveAppAsset('vendor/ffmpeg-core-mt/ffmpeg-core.wasm'),
            workerURL: resolveAppAsset('vendor/ffmpeg-core-mt/ffmpeg-core.worker.js'),
            timeoutMs: MT_LOAD_TIMEOUT_MS,
            label: 'Multithreaded FFmpeg core',
          });
          this.#ffmpeg = mtInstance;
          this.#mode = 'multi';
          this.#fallbackReason = null;
          this.#loaded = true;
          this.#emit('ffmpeg_init_completed', 'Multithreaded FFmpeg.wasm core loaded');
        } catch (err) {
          this.#forceSingleThread = true;
          this.#fallbackReason = `Multithreaded FFmpeg core failed to initialize (${err?.message || err}); using single-thread baseline.`;
          this.#emit('ffmpeg_fallback_single_thread', this.#fallbackReason, 'warn');
        }
      }

      if (!this.#loaded) {
        this.#emit('ffmpeg_init_started', 'Loading single-thread FFmpeg.wasm baseline');
        try {
          const stInstance = await this.#loadCoreInstance({
            classWorkerURL,
            coreURL: resolveAppAsset('vendor/ffmpeg-core/ffmpeg-core.js'),
            wasmURL: resolveAppAsset('vendor/ffmpeg-core/ffmpeg-core.wasm'),
            timeoutMs: ST_LOAD_TIMEOUT_MS,
            label: 'Single-thread FFmpeg core',
          });
          this.#ffmpeg = stInstance;
          this.#mode = 'single';
          if (!this.#fallbackReason && !browserCaps.canMultithread) {
            this.#fallbackReason =
              'Running in single-thread baseline (cross-origin isolation inactive).';
          }
          this.#loaded = true;
          this.#emit('ffmpeg_init_completed', 'Single-thread FFmpeg.wasm baseline loaded');
        } catch (err) {
          const msg = `Single-thread FFmpeg initialization failed: ${err?.message || err}`;
          this.#emit('ffmpeg_init_failed', msg, 'error');
          throw new Error(msg);
        }
      }

      try {
        await this.#discoverSupportedFeatures();
      } catch (err) {
        this.#emit(
          'ffmpeg_init_failed',
          `FFmpeg loaded but encoder/muxer probe failed: ${err?.message || err}`,
          'error'
        );
        try {
          this.#ffmpeg?.terminate();
        } catch {
          // ignore
        }
        this.#ffmpeg = null;
        this.#loaded = false;
        this.#mode = null;
        throw err;
      }

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
      await withTimeout(
        this.#ffmpeg.exec(['-hide_banner', '-encoders']),
        FEATURE_PROBE_TIMEOUT_MS,
        'FFmpeg encoder capability probe'
      );
    } finally {
      this.#ffmpeg.off('log', captureEnc);
    }

    const captureMux = ({ message }) => muxerLines.push(message);
    this.#ffmpeg.on('log', captureMux);
    try {
      await withTimeout(
        this.#ffmpeg.exec(['-hide_banner', '-muxers']),
        FEATURE_PROBE_TIMEOUT_MS,
        'FFmpeg muxer capability probe'
      );
    } finally {
      this.#ffmpeg.off('log', captureMux);
    }

    this.#encoders = parseFFmpegEncoders(encoderLines);
    const parsedMuxers = parseFFmpegMuxers(muxerLines);
    this.#muxers = parsedMuxers.muxers;
    this.#muxerDescriptions = parsedMuxers.descriptions;

    this.#emit(
      'ffmpeg_init_completed',
      `Discovered ${this.#encoders.video.size} video encoders and ${this.#muxers.size} muxers (${this.#mode} mode)`
    );
  }

  /**
   * Prepares an input file inside FFmpeg's virtual FS (MEMFS for <= 64 MB for mobile File reliability,
   * WORKERFS with MEMFS fallback for larger files) and executes `fn(inputVirtualPath)` strictly OUTSIDE
   * the preparation try/catch so execution errors are never swallowed or silently retried.
   */
  async #withPreparedInput(fileOrBlob, ext, onStage, fn) {
    if (!fileOrBlob || typeof fileOrBlob.arrayBuffer !== 'function') {
      throw new Error('Input writing failed: selected media file reference is missing or unreadable.');
    }

    const uid = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const safeExt = ext || sanitizeExt(fileOrBlob?.name);
    const mountDir = `/mnt_${uid}`;
    const safeFileName = `input${safeExt}`;
    let mounted = false;
    let memfsInputPath = null;
    let virtualInputPath = null;

    onStage?.('preparing_input', 'Preparing input file');
    this.#emit(
      'input_writing_started',
      `Preparing input "${fileOrBlob.name || safeFileName}" (${fileOrBlob.size ?? '?'} bytes)`
    );

    try {
      const fileSize = Number(fileOrBlob.size || 0);
      const preferWorkerFs = fileSize > MEMFS_DIRECT_LIMIT_BYTES;

      if (preferWorkerFs) {
        try {
          const aliasFile = new File([fileOrBlob], safeFileName, {
            type: fileOrBlob.type || 'application/octet-stream',
          });
          await this.#ffmpeg.createDir(mountDir);
          const ok = await this.#ffmpeg.mount('WORKERFS', { files: [aliasFile] }, mountDir);
          if (ok) {
            mounted = true;
            virtualInputPath = `${mountDir}/${safeFileName}`;
            this.#emit('input_writing_completed', `Mounted input via WORKERFS: ${virtualInputPath}`);
          }
        } catch (mountErr) {
          this.#emit(
            'input_writing_started',
            `WORKERFS mount unavailable (${mountErr?.message || mountErr}); falling back to MEMFS`,
            'warn'
          );
          try {
            await this.#ffmpeg.deleteDir(mountDir);
          } catch {
            // ignore
          }
        }
      }

      if (!virtualInputPath) {
        try {
          memfsInputPath = `/mem_${uid}${safeExt}`;
          const arrayBuf = await fileOrBlob.arrayBuffer();
          const buf = new Uint8Array(arrayBuf);
          const byteLen = buf.byteLength;
          await this.#ffmpeg.writeFile(memfsInputPath, buf);
          virtualInputPath = memfsInputPath;
          this.#emit(
            'input_writing_completed',
            `Wrote ${byteLen} bytes to MEMFS: ${virtualInputPath}`
          );
        } catch (writeErr) {
          const msg = `Input writing failed: ${writeErr?.message || writeErr}`;
          this.#emit('input_writing_failed', msg, 'error');
          throw new Error(msg);
        }
      }

      // Execute caller function strictly outside mount/write try/catch
      return await fn(virtualInputPath);
    } finally {
      if (mounted && this.#ffmpeg) {
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
      if (memfsInputPath && this.#ffmpeg) {
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
      return await this.#withPreparedInput(fileOrBlob, ext, null, async (inputPath) => {
        try {
          const code = await withTimeout(
            this.#ffmpeg.ffprobe([
              '-v',
              'error',
              '-show_format',
              '-show_streams',
              '-of',
              'json',
              inputPath,
              '-o',
              outJsonPath,
            ]),
            20000,
            'FFprobe stream inspection'
          );
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
          await withTimeout(
            this.#ffmpeg.exec(['-hide_banner', '-i', inputPath]),
            15000,
            'FFmpeg header probe'
          );
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
   * Executes a single video conversion job inside the worker, with automatic single-thread
   * runtime fallback if multithreaded WASM crashes during execution.
   */
  async transcode(params) {
    try {
      return await this.#runTranscodeOnce(params);
    } catch (err) {
      if (
        !this.#cancelled &&
        err?.name !== 'AbortError' &&
        this.#mode === 'multi' &&
        isRuntimeRecoverableMtError(err)
      ) {
        this.#forceSingleThread = true;
        this.#fallbackReason = `Multithreaded runtime failed (${err?.message || err}); retrying in single-thread baseline.`;
        this.#emit('ffmpeg_fallback_single_thread', this.#fallbackReason, 'warn');
        await this.cancelAndReset();
        this.#cancelled = false;
        await this.init({ preferMultithread: false });
        return await this.#runTranscodeOnce(params);
      }
      throw err;
    }
  }

  async #runTranscodeOnce({
    jobId,
    file,
    inputExt,
    outputExt,
    outputMime,
    buildArgs,
    onProgress,
    onStage,
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
      return await this.#withPreparedInput(file, inputExt, onStage, async (inputVirtualPath) => {
        const args = buildArgs(inputVirtualPath, outputVirtualPath);
        onStage?.('encoding', 'Converting video');
        this.#emit('ffmpeg_exec_started', `Executing ffmpeg (${this.#mode}): ${args.join(' ')}`);

        const exitCode = await this.#ffmpeg.exec(args);

        if (this.#cancelled) {
          throw new DOMException('Conversion was cancelled by user.', 'AbortError');
        }
        if (exitCode !== 0) {
          const tail = capturedLogs.slice(-6).join(' | ');
          const msg = `FFmpeg execution failed (exit ${exitCode})${tail ? `: ${tail}` : ''}`;
          this.#emit('ffmpeg_exec_failed', msg, 'error');
          throw new Error(msg);
        }

        onStage?.('reading_output', 'Reading converted output');
        this.#emit('output_reading_started', `Reading output ${outputVirtualPath}`);

        let data;
        try {
          data = await this.#ffmpeg.readFile(outputVirtualPath);
        } catch (readErr) {
          const msg = `Output reading failed: ${readErr?.message || readErr}`;
          this.#emit('output_reading_failed', msg, 'error');
          throw new Error(msg);
        }

        if (!(data instanceof Uint8Array) || data.byteLength === 0) {
          const msg = 'Output reading failed: FFmpeg produced an empty 0-byte output file.';
          this.#emit('output_reading_failed', msg, 'error');
          throw new Error(msg);
        }

        this.#emit('output_reading_completed', `Read ${data.byteLength} bytes from ${outputVirtualPath}`);
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
    this.#initPromise = null;
  }
}
