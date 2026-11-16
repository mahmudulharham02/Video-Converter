import { detectBrowserCapabilities } from './capabilities.js';
import { FFmpegEngineClient } from './ffmpegClient.js';
import { QueueManager } from './queueManager.js';
import { ConverterUI } from './ui.js';

async function bootstrap() {
  const ffmpegClient = new FFmpegEngineClient();
  let ui = null;

  const queueManager = new QueueManager(ffmpegClient, (jobs, summary) => {
    ui?.renderQueue(jobs, summary);
  });

  ui = new ConverterUI(ffmpegClient, queueManager);
  ui.renderQueue(queueManager.jobs, queueManager.getSummary());

  // Initial browser capability probe before async WASM fetch finishes
  const initialCaps = detectBrowserCapabilities();
  ui.setCapabilities({
    ...initialCaps,
    activeMode: initialCaps.canMultithread ? 'multi' : 'single',
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
