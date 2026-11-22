import { detectBrowserCapabilities } from './capabilities.js';
import { FFmpegEngineClient } from './ffmpegClient.js';
import { QueueManager } from './queueManager.js';
import { ConverterUI } from './ui.js';

async function bootstrap() {
  const ffmpegClient = new FFmpegEngineClient();
  let ui = null;

  const forwardDiagnostic = (entry) => {
    ui?.addDiagnostic(entry);
  };

  ffmpegClient.setDiagnosticHandler(forwardDiagnostic);

  const queueManager = new QueueManager(
    ffmpegClient,
    (jobs, summary) => {
      ui?.renderQueue(jobs, summary);
    },
    forwardDiagnostic
  );

  ui = new ConverterUI(ffmpegClient, queueManager);
  ui.renderQueue(queueManager.jobs, queueManager.getSummary());

  globalThis.addEventListener('error', (event) => {
    forwardDiagnostic({
      timestamp: Date.now(),
      stage: 'runtime_error',
      message: event?.message || 'Unhandled script error',
      level: 'error',
    });
  });

  globalThis.addEventListener('unhandledrejection', (event) => {
    const reason = event?.reason;
    forwardDiagnostic({
      timestamp: Date.now(),
      stage: 'unhandled_rejection',
      message: reason?.message || String(reason || 'Unhandled promise rejection'),
      level: 'error',
    });
  });

  // Initial browser capability probe before async WASM fetch finishes
  const initialCaps = detectBrowserCapabilities();
  forwardDiagnostic({
    timestamp: Date.now(),
    stage: 'startup',
    message: `Booting WebFF (isolated=${initialCaps.crossOriginIsolated}, SAB=${initialCaps.sharedArrayBuffer}, mobile=${initialCaps.isMobile}, safeMT=${initialCaps.safeMultithread}, cores=${initialCaps.hardwareConcurrency ?? '?'}, memGB=${initialCaps.deviceMemoryGb ?? '?'})`,
    level: 'info',
  });

  ui.setCapabilities({
    ...initialCaps,
    activeMode: null,
    initializing: true,
    encoders: { video: new Set(), audio: new Set(), subtitle: new Set() },
    muxers: new Set(),
  });
  ui.setEngineStatus('Loading FFmpeg WebAssembly engine…');

  try {
    const fullCaps = await ffmpegClient.init({ preferMultithread: true });
    ui.setCapabilities(fullCaps);
  } catch (err) {
    ui.setEngineStatus(
      `FFmpeg.wasm failed to initialize: ${err?.message || err}`,
      true
    );
  }
}

bootstrap();
