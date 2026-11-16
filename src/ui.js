import { evaluateFileMemoryRisk } from './capabilities.js';
import {
  ASPECT_RATIO_OPTIONS,
  AUDIO_ENCODERS,
  FPS_PRESETS,
  RESOLUTION_PRESETS,
  SCALING_MODES,
  VIDEO_ENCODERS,
  createDefaultSettings,
  getAvailableAudioEncodersForContainer,
  getAvailableContainers,
  getAvailableVideoEncodersForContainer,
  getEffectiveSourceDimensions,
  solveOutputDimensions,
  validateSettings,
} from './codecs.js';
import {
  formatBitrate,
  formatBytes,
  formatDuration,
  formatField,
  inspectMedia,
} from './mediaInspector.js';

function el(tag, className = '', text = null) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== null && text !== undefined) node.textContent = String(text);
  return node;
}

function populateSelect(selectEl, options, selectedValue) {
  selectEl.textContent = '';
  for (const opt of options) {
    const o = document.createElement('option');
    o.value = String(opt.value);
    o.textContent = opt.label;
    if (opt.disabled) o.disabled = true;
    selectEl.appendChild(o);
  }
  if (selectedValue !== undefined && selectedValue !== null) {
    selectEl.value = String(selectedValue);
  }
}

function summarizeJobSettings(settings) {
  const parts = [settings.container.toUpperCase()];
  const vEnc = VIDEO_ENCODERS[settings.videoCodec];
  const vLabel = vEnc ? vEnc.family.toUpperCase() : settings.videoCodec;

  if (settings.rateControlMode === 'crf') {
    parts.push(`${vLabel} CRF ${settings.crf}`);
  } else if (settings.rateControlMode === 'qscale') {
    parts.push(`${vLabel} q:${settings.qscale}`);
  } else {
    parts.push(
      `${vLabel} ${settings.rateControlMode.toUpperCase()} ${settings.videoBitrateValue} ${settings.videoBitrateUnit === 'mbps' ? 'Mbps' : 'Kbps'}`
    );
  }

  if (settings.resolutionPreset === 'original' && settings.aspectRatioMode === 'original') {
    parts.push('Original res');
  } else {
    parts.push(`${settings.customWidth}×${settings.customHeight} (${settings.scalingMode})`);
  }

  if (settings.fpsMode === 'original') {
    parts.push('Original fps');
  } else if (settings.fpsMode === 'custom') {
    parts.push(`${settings.customFps} fps`);
  } else {
    parts.push(`${settings.fpsMode} fps`);
  }

  if (settings.audioMode === 'none') {
    parts.push('No audio');
  } else if (settings.audioMode === 'copy') {
    parts.push('Audio copy');
  } else {
    const aEnc = AUDIO_ENCODERS[settings.audioCodec];
    const aName = aEnc ? aEnc.family.toUpperCase() : settings.audioCodec;
    parts.push(aEnc?.lossless ? aName : `${aName} ${settings.audioBitrateKbps}k`);
  }

  return parts.join(' · ');
}

export class ConverterUI {
  #ffmpegClient;
  #queueManager;
  #capabilities = null;

  #currentFile = null;
  #currentInspection = null;
  #draftSettings = null;
  #lastQueuedSettings = null;
  #editingJobId = null;

  #dom = {};

  constructor(ffmpegClient, queueManager) {
    this.#ffmpegClient = ffmpegClient;
    this.#queueManager = queueManager;
    this.#cacheDom();
    this.#initTheme();
    this.#bindEvents();
  }

  #cacheDom() {
    const ids = [
      'engineStatusBar',
      'themeSelect',
      'reusePrevBtn',
      'browserCapsBanner',
      'editJobBanner',
      'editJobLabel',
      'cancelEditBtn',
      'dropZone',
      'videoFileInput',
      'dropZonePrimary',
      'dropZoneSecondary',
      'browseFileBtn',
      'fileRiskNotice',
      'inspectionSection',
      'inspectionSourceTag',
      'inspectionSummary',
      'inspectionStreams',
      'settingsForm',
      'computedResolutionPreview',
      'containerSelect',
      'videoCodecSelect',
      'rateControlSelect',
      'rateControlHint',
      'crfField',
      'crfLabel',
      'crfRange',
      'crfInput',
      'videoBitrateField',
      'videoBitrateInput',
      'videoBitrateUnit',
      'resolutionPresetSelect',
      'customDimsField',
      'widthInput',
      'heightInput',
      'dimsHint',
      'aspectRatioSelect',
      'customAspectWrap',
      'customAspectW',
      'customAspectH',
      'scalingModeSelect',
      'scalingModeHint',
      'fpsSelect',
      'customFpsInput',
      'vfrPolicyField',
      'vfrPolicySelect',
      'audioModeSelect',
      'audioCodecField',
      'audioCodecSelect',
      'audioBitrateField',
      'audioBitratePresetSelect',
      'audioBitrateInput',
      'presetField',
      'presetSelect',
      'profileField',
      'profileSelect',
      'levelField',
      'levelSelect',
      'pixelFormatField',
      'pixelFormatSelect',
      'gopField',
      'gopInput',
      'audioSampleRateField',
      'audioSampleRateSelect',
      'audioChannelsField',
      'audioChannelsSelect',
      'videoStreamField',
      'videoStreamSelect',
      'audioStreamField',
      'audioStreamSelect',
      'subtitleModeField',
      'subtitleModeSelect',
      'subtitleStreamField',
      'subtitleStreamSelect',
      'fastStartField',
      'fastStartCheckbox',
      'validationFeedback',
      'addToQueueBtn',
      'queueStatsLine',
      'clearFinishedBtn',
      'startQueueBtn',
      'overallProgressBox',
      'overallProgressLabel',
      'overallProgressPct',
      'overallProgressBarWrap',
      'overallProgressFill',
      'queueEmptyState',
      'queueList',
    ];
    for (const id of ids) {
      this.#dom[id] = document.getElementById(id);
    }
  }

  #initTheme() {
    const saved = localStorage.getItem('webff_theme') || 'system';
    this.#dom.themeSelect.value = saved;
    this.#applyTheme(saved);
    this.#dom.themeSelect.addEventListener('change', (e) => {
      const val = e.target.value;
      localStorage.setItem('webff_theme', val);
      this.#applyTheme(val);
    });
  }

  #applyTheme(mode) {
    if (mode === 'light' || mode === 'dark') {
      document.documentElement.setAttribute('data-theme', mode);
    } else {
      document.documentElement.removeAttribute('data-theme');
    }
  }

  setCapabilities(caps) {
    this.#capabilities = caps;
    this.#renderCapabilitiesBanner(caps);
    if (this.#currentInspection && this.#draftSettings) {
      this.#syncFormFromDraft();
    }
  }

  setEngineStatus(text, isError = false) {
    this.#dom.engineStatusBar.textContent = text;
    this.#dom.engineStatusBar.style.color = isError ? 'var(--danger)' : '';
  }

  #renderCapabilitiesBanner(caps) {
    const stack = this.#dom.browserCapsBanner;
    stack.textContent = '';

    if (!caps.webAssembly || !caps.workers) {
      const n = el('div', 'notice notice-error', caps.warnings.join(' '));
      stack.appendChild(n);
      this.setEngineStatus('Browser unsupported (missing WebAssembly or Workers)', true);
      return;
    }

    const modeLabel =
      caps.activeMode === 'multi'
        ? `Multithread WASM (${caps.hardwareConcurrency || '?'} threads)`
        : 'Single-thread WASM';
    const encCount = caps.encoders?.video?.size || 0;
    const muxCount = caps.muxers?.size || 0;
    this.setEngineStatus(`${modeLabel} · ${encCount} video encoders · ${muxCount} muxers`);

    if (caps.activeMode !== 'multi') {
      const msg =
        caps.fallbackReason ||
        'SharedArrayBuffer / cross-origin isolation is unavailable; running single-thread baseline.';
      stack.appendChild(el('div', 'notice notice-info', msg));
    }
  }

  #bindEvents() {
    const d = this.#dom;

    // File picking & dropzone
    d.browseFileBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      d.videoFileInput.click();
    });
    d.dropZone.addEventListener('click', () => d.videoFileInput.click());
    d.dropZone.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        d.videoFileInput.click();
      }
    });
    d.dropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      d.dropZone.classList.add('is-dragover');
    });
    d.dropZone.addEventListener('dragleave', () => {
      d.dropZone.classList.remove('is-dragover');
    });
    d.dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      d.dropZone.classList.remove('is-dragover');
      const file = e.dataTransfer?.files?.[0];
      if (file) this.#handleFileSelected(file);
    });
    d.videoFileInput.addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      if (file) this.#handleFileSelected(file);
      e.target.value = '';
    });

    // Explicit opt-in reuse previous settings
    d.reusePrevBtn.addEventListener('click', () => {
      if (!this.#lastQueuedSettings || !this.#currentInspection) return;
      this.#draftSettings = structuredClone(this.#lastQueuedSettings);
      // Reset stream indices safely if new video has fewer streams
      if (this.#draftSettings.videoStreamIndex >= this.#currentInspection.videoStreams.length) {
        this.#draftSettings.videoStreamIndex = 0;
      }
      if (this.#draftSettings.audioStreamIndex >= this.#currentInspection.audioStreams.length) {
        this.#draftSettings.audioStreamIndex = 0;
      }
      if (this.#currentInspection.audioStreams.length === 0) {
        this.#draftSettings.audioMode = 'none';
      }
      this.#syncFormFromDraft();
    });

    d.cancelEditBtn.addEventListener('click', () => {
      this.#editingJobId = null;
      this.#clearCurrentWorkbench('Edit cancelled. Select a video or edit another pending job.');
    });

    // Form control changes
    d.containerSelect.addEventListener('change', () => {
      if (!this.#draftSettings) return;
      this.#draftSettings.container = d.containerSelect.value;
      this.#reconcileContainerChange();
      this.#syncFormFromDraft();
    });

    d.videoCodecSelect.addEventListener('change', () => {
      if (!this.#draftSettings) return;
      this.#draftSettings.videoCodec = d.videoCodecSelect.value;
      this.#reconcileVideoCodecChange();
      this.#syncFormFromDraft();
    });

    d.rateControlSelect.addEventListener('change', () => {
      if (!this.#draftSettings) return;
      this.#draftSettings.rateControlMode = d.rateControlSelect.value;
      this.#syncFormFromDraft();
    });

    d.crfRange.addEventListener('input', () => {
      if (!this.#draftSettings) return;
      const val = Number(d.crfRange.value);
      if (this.#draftSettings.rateControlMode === 'qscale') this.#draftSettings.qscale = val;
      else this.#draftSettings.crf = val;
      d.crfInput.value = String(val);
      this.#renderValidation();
    });

    d.crfInput.addEventListener('input', () => {
      if (!this.#draftSettings) return;
      const val = Number(d.crfInput.value);
      if (this.#draftSettings.rateControlMode === 'qscale') this.#draftSettings.qscale = val;
      else this.#draftSettings.crf = val;
      d.crfRange.value = String(val);
      this.#renderValidation();
    });

    d.videoBitrateInput.addEventListener('input', () => {
      if (!this.#draftSettings) return;
      this.#draftSettings.videoBitrateValue = Number(d.videoBitrateInput.value);
      this.#renderValidation();
    });

    d.videoBitrateUnit.addEventListener('change', () => {
      if (!this.#draftSettings) return;
      const prevUnit = this.#draftSettings.videoBitrateUnit;
      const nextUnit = d.videoBitrateUnit.value;
      if (prevUnit !== nextUnit && Number.isFinite(this.#draftSettings.videoBitrateValue)) {
        this.#draftSettings.videoBitrateValue =
          nextUnit === 'mbps'
            ? Number((this.#draftSettings.videoBitrateValue / 1000).toFixed(2))
            : Math.round(this.#draftSettings.videoBitrateValue * 1000);
      }
      this.#draftSettings.videoBitrateUnit = nextUnit;
      d.videoBitrateInput.value = String(this.#draftSettings.videoBitrateValue);
      this.#renderValidation();
    });

    // Resolution & live aspect ratio solver
    d.resolutionPresetSelect.addEventListener('change', () => {
      if (!this.#draftSettings) return;
      this.#draftSettings.resolutionPreset = d.resolutionPresetSelect.value;
      this.#recomputeDimsIntoDraft();
      this.#syncFormFromDraft();
    });

    d.widthInput.addEventListener('input', () => {
      if (!this.#draftSettings) return;
      const w = Number(d.widthInput.value);
      this.#draftSettings.resolutionPreset = 'custom';
      this.#draftSettings.customWidth = w;
      this.#draftSettings.lastEditedDimension = 'width';
      d.resolutionPresetSelect.value = 'custom';

      if (this.#draftSettings.scalingMode !== 'stretch' && w > 0) {
        const solved = this.#solveDraftDims();
        if (solved.height) {
          this.#draftSettings.customHeight = solved.height;
          d.heightInput.value = String(solved.height);
        }
      }
      this.#updateComputedDimsPreview();
      this.#renderValidation();
    });

    d.heightInput.addEventListener('input', () => {
      if (!this.#draftSettings) return;
      const h = Number(d.heightInput.value);
      this.#draftSettings.resolutionPreset = 'custom';
      this.#draftSettings.customHeight = h;
      this.#draftSettings.lastEditedDimension = 'height';
      d.resolutionPresetSelect.value = 'custom';

      if (this.#draftSettings.scalingMode !== 'stretch' && h > 0) {
        const solved = this.#solveDraftDims();
        if (solved.width) {
          this.#draftSettings.customWidth = solved.width;
          d.widthInput.value = String(solved.width);
        }
      }
      this.#updateComputedDimsPreview();
      this.#renderValidation();
    });

    d.aspectRatioSelect.addEventListener('change', () => {
      if (!this.#draftSettings) return;
      this.#draftSettings.aspectRatioMode = d.aspectRatioSelect.value;
      this.#recomputeDimsIntoDraft();
      this.#syncFormFromDraft();
    });

    const handleCustomAspectChange = () => {
      if (!this.#draftSettings) return;
      this.#draftSettings.customAspectWidth = Number(d.customAspectW.value);
      this.#draftSettings.customAspectHeight = Number(d.customAspectH.value);
      this.#recomputeDimsIntoDraft();
      this.#updateComputedDimsPreview();
      this.#renderValidation();
    };
    d.customAspectW.addEventListener('input', handleCustomAspectChange);
    d.customAspectH.addEventListener('input', handleCustomAspectChange);

    d.scalingModeSelect.addEventListener('change', () => {
      if (!this.#draftSettings) return;
      this.#draftSettings.scalingMode = d.scalingModeSelect.value;
      if (this.#draftSettings.scalingMode !== 'stretch') {
        this.#recomputeDimsIntoDraft();
      }
      this.#syncFormFromDraft();
    });

    // FPS & VFR
    d.fpsSelect.addEventListener('change', () => {
      if (!this.#draftSettings) return;
      this.#draftSettings.fpsMode = d.fpsSelect.value;
      this.#syncFormFromDraft();
    });
    d.customFpsInput.addEventListener('input', () => {
      if (!this.#draftSettings) return;
      this.#draftSettings.customFps = Number(d.customFpsInput.value);
      this.#renderValidation();
    });
    d.vfrPolicySelect.addEventListener('change', () => {
      if (!this.#draftSettings) return;
      this.#draftSettings.vfrPolicy = d.vfrPolicySelect.value;
      this.#renderValidation();
    });

    // Audio
    d.audioModeSelect.addEventListener('change', () => {
      if (!this.#draftSettings) return;
      this.#draftSettings.audioMode = d.audioModeSelect.value;
      this.#syncFormFromDraft();
    });
    d.audioCodecSelect.addEventListener('change', () => {
      if (!this.#draftSettings) return;
      this.#draftSettings.audioCodec = d.audioCodecSelect.value;
      const aEnc = AUDIO_ENCODERS[this.#draftSettings.audioCodec];
      if (aEnc && !aEnc.lossless && aEnc.defaultKbps) {
        this.#draftSettings.audioBitrateKbps = aEnc.defaultKbps;
      }
      this.#syncFormFromDraft();
    });
    d.audioBitratePresetSelect.addEventListener('change', () => {
      if (!this.#draftSettings) return;
      const val = Number(d.audioBitratePresetSelect.value);
      if (val > 0) {
        this.#draftSettings.audioBitrateKbps = val;
        d.audioBitrateInput.value = String(val);
        this.#renderValidation();
      }
    });
    d.audioBitrateInput.addEventListener('input', () => {
      if (!this.#draftSettings) return;
      this.#draftSettings.audioBitrateKbps = Number(d.audioBitrateInput.value);
      this.#renderValidation();
    });

    // Advanced parameters
    d.presetSelect.addEventListener('change', () => {
      if (!this.#draftSettings) return;
      this.#draftSettings.preset = d.presetSelect.value;
    });
    d.profileSelect.addEventListener('change', () => {
      if (!this.#draftSettings) return;
      this.#draftSettings.profile = d.profileSelect.value;
    });
    d.levelSelect.addEventListener('change', () => {
      if (!this.#draftSettings) return;
      this.#draftSettings.level = d.levelSelect.value;
    });
    d.pixelFormatSelect.addEventListener('change', () => {
      if (!this.#draftSettings) return;
      this.#draftSettings.pixelFormat = d.pixelFormatSelect.value;
    });
    d.gopInput.addEventListener('input', () => {
      if (!this.#draftSettings) return;
      this.#draftSettings.gopSize = d.gopInput.value.trim();
      this.#renderValidation();
    });
    d.audioSampleRateSelect.addEventListener('change', () => {
      if (!this.#draftSettings) return;
      this.#draftSettings.audioSampleRate = Number(d.audioSampleRateSelect.value);
    });
    d.audioChannelsSelect.addEventListener('change', () => {
      if (!this.#draftSettings) return;
      this.#draftSettings.audioChannels = Number(d.audioChannelsSelect.value);
      this.#renderValidation();
    });
    d.videoStreamSelect.addEventListener('change', () => {
      if (!this.#draftSettings) return;
      this.#draftSettings.videoStreamIndex = Number(d.videoStreamSelect.value);
      this.#recomputeDimsIntoDraft();
      this.#syncFormFromDraft();
    });
    d.audioStreamSelect.addEventListener('change', () => {
      if (!this.#draftSettings) return;
      this.#draftSettings.audioStreamIndex = Number(d.audioStreamSelect.value);
      this.#renderValidation();
    });
    d.subtitleModeSelect.addEventListener('change', () => {
      if (!this.#draftSettings) return;
      this.#draftSettings.subtitleMode = d.subtitleModeSelect.value;
      this.#syncFormFromDraft();
    });
    d.subtitleStreamSelect.addEventListener('change', () => {
      if (!this.#draftSettings) return;
      this.#draftSettings.subtitleStreamIndex = Number(d.subtitleStreamSelect.value);
    });
    d.fastStartCheckbox.addEventListener('change', () => {
      if (!this.#draftSettings) return;
      this.#draftSettings.fastStart = d.fastStartCheckbox.checked;
    });

    // Submit (Add to queue or save edit)
    d.settingsForm.addEventListener('submit', (e) => {
      e.preventDefault();
      if (!this.#currentFile || !this.#currentInspection || !this.#draftSettings) return;
      const validation = validateSettings(
        this.#draftSettings,
        this.#currentInspection,
        this.#capabilities
      );
      if (!validation.valid) {
        this.#renderValidation();
        return;
      }

      this.#lastQueuedSettings = structuredClone(this.#draftSettings);
      d.reusePrevBtn.disabled = false;

      if (this.#editingJobId) {
        this.#queueManager.updatePendingJob(this.#editingJobId, this.#draftSettings);
        const editedName = this.#currentFile.name;
        this.#editingJobId = null;
        this.#clearCurrentWorkbench(`Saved changes for "${editedName}". Select another video or start the queue.`);
      } else {
        this.#queueManager.addJob({
          file: this.#currentFile,
          inspection: this.#currentInspection,
          settings: this.#draftSettings,
        });
        const addedName = this.#currentFile.name;
        this.#clearCurrentWorkbench(`Added "${addedName}" to queue. Select another video to configure independently.`);
      }
    });

    // Queue Header Controls
    d.startQueueBtn.addEventListener('click', () => {
      this.#queueManager.startQueue();
    });
    d.clearFinishedBtn.addEventListener('click', () => {
      this.#queueManager.clearFinished();
    });
  }

  async #handleFileSelected(file) {
    this.#editingJobId = null;
    this.#dom.editJobBanner.hidden = true;
    this.#currentFile = file;
    this.#currentInspection = null;
    this.#draftSettings = null;

    this.#dom.dropZonePrimary.textContent = file.name;
    this.#dom.dropZoneSecondary.textContent = `${formatBytes(file.size)} · Inspecting media streams…`;
    this.#dom.inspectionSection.hidden = true;
    this.#dom.settingsForm.hidden = true;
    this.#dom.reusePrevBtn.disabled = true;

    const risk = evaluateFileMemoryRisk(file.size, this.#capabilities?.deviceMemoryGb);
    this.#dom.fileRiskNotice.textContent = '';
    if (risk.message) {
      const cls = risk.level === 'danger' ? 'notice notice-error' : 'notice notice-warning';
      this.#dom.fileRiskNotice.appendChild(el('div', cls, risk.message));
    }

    try {
      // Ensure engine is initialized so hybrid inspection has FFprobe/FFmpeg available
      if (!this.#ffmpegClient.isLoaded && !this.#ffmpegClient.isBusy) {
        try {
          const caps = await this.#ffmpegClient.init();
          this.setCapabilities(caps);
        } catch {
          // Proceed with MediaInfo-only inspection if FFmpeg init failed
        }
      }

      const inspection = await inspectMedia(file, file.name, this.#ffmpegClient);
      this.#currentInspection = inspection;
      this.#draftSettings = createDefaultSettings(inspection, this.#capabilities);

      this.#dom.dropZoneSecondary.textContent = `${formatBytes(file.size)} · Inspection complete`;
      this.#dom.reusePrevBtn.disabled = !this.#lastQueuedSettings;

      this.#renderInspection(inspection);
      this.#syncFormFromDraft();

      this.#dom.inspectionSection.hidden = false;
      this.#dom.settingsForm.hidden = false;
    } catch (err) {
      this.#dom.dropZoneSecondary.textContent = 'Inspection failed';
      this.#dom.fileRiskNotice.appendChild(
        el('div', 'notice notice-error', `Failed to inspect file: ${err?.message || err}`)
      );
    }
  }

  #clearCurrentWorkbench(statusMessage) {
    this.#currentFile = null;
    this.#currentInspection = null;
    this.#draftSettings = null;
    this.#dom.editJobBanner.hidden = true;
    this.#dom.inspectionSection.hidden = true;
    this.#dom.settingsForm.hidden = true;
    this.#dom.reusePrevBtn.disabled = true;
    this.#dom.dropZonePrimary.textContent = 'Choose a video file or drop it here';
    this.#dom.dropZoneSecondary.textContent =
      statusMessage || 'Inspected locally via MediaInfo WASM and FFmpeg stream probe';
    this.#dom.fileRiskNotice.textContent = '';
  }

  #loadJobIntoEditor(job) {
    this.#editingJobId = job.id;
    this.#currentFile = job.file;
    this.#currentInspection = job.inspection;
    this.#draftSettings = structuredClone(job.settings);

    this.#dom.editJobBanner.hidden = false;
    this.#dom.editJobLabel.textContent = `Editing queued job: ${job.fileName}`;
    this.#dom.dropZonePrimary.textContent = job.fileName;
    this.#dom.dropZoneSecondary.textContent = `${formatBytes(job.fileSize)} · Editing independent configuration`;
    this.#dom.reusePrevBtn.disabled = !this.#lastQueuedSettings;

    this.#renderInspection(job.inspection);
    this.#syncFormFromDraft();

    this.#dom.inspectionSection.hidden = false;
    this.#dom.settingsForm.hidden = false;
    this.#dom.settingsForm.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  #renderInspection(ins) {
    this.#dom.inspectionSourceTag.textContent = `Source: ${ins.inspectionSource}`;
    const grid = this.#dom.inspectionSummary;
    grid.textContent = '';

    const v0 = ins.videoStreams[0];
    const a0 = ins.audioStreams[0];

    const items = [
      ['Filename', { value: ins.fileName, status: 'known' }],
      ['File Size', { value: formatBytes(ins.fileSize), status: 'known' }],
      ['Container', ins.container],
      ['Duration', ins.durationSec, formatDuration],
      ['Overall Bitrate', ins.overallBitrateBps, formatBitrate],
      ['Streams', ins.streamCount],
      [
        'Video Resolution',
        v0?.width?.value && v0?.height?.value
          ? { value: `${v0.width.value}×${v0.height.value}`, status: 'known' }
          : { value: null, status: 'undetermined' },
      ],
      [
        'Frame Rate',
        v0?.fps?.value
          ? {
              value: `${v0.fps.value.toFixed(3).replace(/\.?0+$/, '')} fps (${formatField(v0.fpsMode)})`,
              status: 'known',
            }
          : { value: null, status: 'undetermined' },
      ],
      ['Pixel Format', v0?.pixelFormat],
      ['Video Codec', v0?.codec],
      ['Video Bitrate', v0?.bitrateBps, formatBitrate],
      [
        'Rotation',
        v0?.rotationDeg?.value
          ? { value: `${v0.rotationDeg.value}°`, status: 'known' }
          : { value: '0° (None)', status: 'known' },
      ],
      ['Audio Codec', a0 ? a0.codec : { value: null, status: 'missing' }],
      [
        'Sample Rate',
        a0 ? a0.sampleRateHz : { value: null, status: 'missing' },
        (hz) => `${hz} Hz`,
      ],
      [
        'Audio Channels',
        a0 ? a0.channels : { value: null, status: 'missing' },
        (ch) => (ch === 1 ? '1 (Mono)' : ch === 2 ? '2 (Stereo)' : `${ch} ch`),
      ],
    ];

    for (const [label, field, formatter] of items) {
      const cell = el('div', 'inspect-cell');
      cell.appendChild(el('span', 'inspect-label', label));
      const formatted = formatField(field, formatter);
      const isMissing = !field || field.value === null || field.value === undefined;
      cell.appendChild(el('span', `inspect-value${isMissing ? ' is-muted' : ''}`, formatted));
      grid.appendChild(cell);
    }

    const streamsEl = this.#dom.inspectionStreams;
    streamsEl.textContent = '';

    for (const vs of ins.videoStreams) {
      const row = el('div', 'stream-row');
      row.appendChild(el('span', 'stream-type', `Video #${vs.index}`));
      const text = [
        formatField(vs.codec),
        vs.width.value && vs.height.value ? `${vs.width.value}×${vs.height.value}` : 'Res undetermined',
        vs.fps.value ? `${vs.fps.value.toFixed(2)} fps (${formatField(vs.fpsMode)})` : 'FPS undetermined',
        `DAR ${formatField(vs.displayAspectRatio)}`,
        `Pix ${formatField(vs.pixelFormat)}`,
        `Bitrate ${formatField(vs.bitrateBps, formatBitrate)}`,
      ].join(' · ');
      row.appendChild(el('span', 'stream-meta', text));
      streamsEl.appendChild(row);
    }

    for (const as of ins.audioStreams) {
      const row = el('div', 'stream-row');
      row.appendChild(el('span', 'stream-type', `Audio #${as.index}`));
      const text = [
        formatField(as.codec),
        formatField(as.sampleRateHz, (hz) => `${hz} Hz`),
        formatField(as.channels, (ch) => `${ch} ch`),
        `Bitrate ${formatField(as.bitrateBps, formatBitrate)}`,
        as.language.value ? `Lang: ${as.language.value}` : null,
      ]
        .filter(Boolean)
        .join(' · ');
      row.appendChild(el('span', 'stream-meta', text));
      streamsEl.appendChild(row);
    }

    for (const ss of ins.subtitleStreams) {
      const row = el('div', 'stream-row');
      row.appendChild(el('span', 'stream-type', `Subtitle #${ss.index}`));
      const text = [
        formatField(ss.codec),
        ss.language.value ? `Lang: ${ss.language.value}` : 'Language missing',
        ss.title.value || null,
      ]
        .filter(Boolean)
        .join(' · ');
      row.appendChild(el('span', 'stream-meta', text));
      streamsEl.appendChild(row);
    }
  }

  #reconcileContainerChange() {
    const s = this.#draftSettings;
    const validVideos = getAvailableVideoEncodersForContainer(s.container, this.#capabilities);
    if (!validVideos.some((v) => v.id === s.videoCodec)) {
      s.videoCodec = validVideos[0]?.id || 'libx264';
      this.#reconcileVideoCodecChange();
    }

    const validAudios = getAvailableAudioEncodersForContainer(s.container, this.#capabilities);
    if (!validAudios.some((a) => a.id === s.audioCodec)) {
      s.audioCodec = validAudios[0]?.id || 'aac';
      const aEnc = AUDIO_ENCODERS[s.audioCodec];
      if (aEnc && !aEnc.lossless && aEnc.defaultKbps) {
        s.audioBitrateKbps = aEnc.defaultKbps;
      }
    }
  }

  #reconcileVideoCodecChange() {
    const s = this.#draftSettings;
    const vEnc = VIDEO_ENCODERS[s.videoCodec];
    if (!vEnc) return;
    if (!vEnc.rateControls.includes(s.rateControlMode)) {
      s.rateControlMode = vEnc.defaultRateControl;
    }
    if (vEnc.crf) {
      s.crf = vEnc.crf.default;
    }
    if (vEnc.qscale) {
      s.qscale = vEnc.qscale.default;
    }
    s.preset = vEnc.defaultPreset || '';
    s.profile = '';
    s.level = '';
    s.pixelFormat = vEnc.defaultPixelFormat || '';
  }

  #solveDraftDims() {
    const s = this.#draftSettings;
    const vEnc = VIDEO_ENCODERS[s.videoCodec];
    const videoStream =
      this.#currentInspection?.videoStreams?.[s.videoStreamIndex] ||
      this.#currentInspection?.videoStreams?.[0];
    return solveOutputDimensions({
      videoStream,
      resolutionPreset: s.resolutionPreset,
      customWidth: s.customWidth,
      customHeight: s.customHeight,
      lastEditedDimension: s.lastEditedDimension,
      aspectRatioMode: s.aspectRatioMode,
      customAspectWidth: s.customAspectWidth,
      customAspectHeight: s.customAspectHeight,
      scalingMode: s.scalingMode,
      requiresEven: vEnc?.requiresEvenDimensions ?? true,
    });
  }

  #recomputeDimsIntoDraft() {
    const solved = this.#solveDraftDims();
    if (solved.width && solved.height) {
      this.#draftSettings.customWidth = solved.width;
      this.#draftSettings.customHeight = solved.height;
    }
  }

  #updateComputedDimsPreview() {
    const solved = this.#solveDraftDims();
    this.#dom.computedResolutionPreview.textContent =
      solved.width && solved.height
        ? `Target frame: ${solved.width} × ${solved.height}`
        : 'Target frame: undetermined';
  }

  #syncFormFromDraft() {
    const d = this.#dom;
    const s = this.#draftSettings;
    const ins = this.#currentInspection;
    if (!s || !ins) return;

    // 1. Containers
    const containers = getAvailableContainers(this.#capabilities);
    populateSelect(
      d.containerSelect,
      containers.map((c) => ({ value: c.id, label: c.label })),
      s.container
    );

    // 2. Video Codecs
    const vEncoders = getAvailableVideoEncodersForContainer(s.container, this.#capabilities);
    populateSelect(
      d.videoCodecSelect,
      vEncoders.map((v) => ({ value: v.id, label: v.label })),
      s.videoCodec
    );

    // 3. Rate Control
    const vEnc = VIDEO_ENCODERS[s.videoCodec] || VIDEO_ENCODERS.libx264;
    const rcLabels = {
      crf: 'Quality-based (CRF)',
      qscale: 'Quantizer quality (q:v)',
      vbr: 'Variable Bitrate (VBR target)',
      cbr: 'Constant Bitrate (CBR constrained)',
    };
    populateSelect(
      d.rateControlSelect,
      vEnc.rateControls.map((rc) => ({ value: rc, label: rcLabels[rc] || rc.toUpperCase() })),
      s.rateControlMode
    );

    const isCrf = s.rateControlMode === 'crf';
    const isQ = s.rateControlMode === 'qscale';
    d.crfField.hidden = !isCrf && !isQ;
    d.videoBitrateField.hidden = isCrf || isQ;

    if (isCrf && vEnc.crf) {
      d.crfLabel.textContent = vEnc.crf.label;
      d.crfRange.min = String(vEnc.crf.min);
      d.crfRange.max = String(vEnc.crf.max);
      d.crfInput.min = String(vEnc.crf.min);
      d.crfInput.max = String(vEnc.crf.max);
      d.crfRange.value = String(s.crf);
      d.crfInput.value = String(s.crf);
      d.rateControlHint.textContent = 'Constant quality mode: encoder varies bitrate dynamically.';
    } else if (isQ && vEnc.qscale) {
      d.crfLabel.textContent = vEnc.qscale.label;
      d.crfRange.min = String(vEnc.qscale.min);
      d.crfRange.max = String(vEnc.qscale.max);
      d.crfInput.min = String(vEnc.qscale.min);
      d.crfInput.max = String(vEnc.qscale.max);
      d.crfRange.value = String(s.qscale);
      d.crfInput.value = String(s.qscale);
      d.rateControlHint.textContent = 'Fixed quantizer scale mode (lower value = higher quality).';
    } else if (s.rateControlMode === 'cbr') {
      d.rateControlHint.textContent = 'Constrained bitrate using minrate/maxrate/bufsize bounds.';
    } else {
      d.rateControlHint.textContent = 'Targets average output bitrate across the video.';
    }

    d.videoBitrateInput.value = String(s.videoBitrateValue);
    d.videoBitrateUnit.value = s.videoBitrateUnit;

    // 4. Resolution & Aspect Ratio
    populateSelect(
      d.resolutionPresetSelect,
      RESOLUTION_PRESETS.map((p) => ({ value: p.id, label: p.label })),
      s.resolutionPreset
    );
    const dimsSolved = this.#solveDraftDims();
    d.widthInput.value = String(dimsSolved.width || s.customWidth || '');
    d.heightInput.value = String(dimsSolved.height || s.customHeight || '');
    const srcEff = getEffectiveSourceDimensions(
      ins.videoStreams[s.videoStreamIndex] || ins.videoStreams[0]
    );
    d.dimsHint.textContent = srcEff.rotated
      ? 'Source rotation metadata detected; effective display orientation is used for aspect calculations.'
      : 'Editing either dimension recalculates the other using effective display aspect ratio.';

    populateSelect(
      d.aspectRatioSelect,
      ASPECT_RATIO_OPTIONS.map((a) => ({ value: a.id, label: a.label })),
      s.aspectRatioMode
    );
    d.customAspectWrap.hidden = s.aspectRatioMode !== 'custom';
    d.customAspectW.value = String(s.customAspectWidth);
    d.customAspectH.value = String(s.customAspectHeight);

    populateSelect(
      d.scalingModeSelect,
      SCALING_MODES.map((m) => ({ value: m.id, label: m.label })),
      s.scalingMode
    );
    const activeScaling = SCALING_MODES.find((m) => m.id === s.scalingMode);
    d.scalingModeHint.textContent = activeScaling?.description || '';
    this.#updateComputedDimsPreview();

    // 5. FPS & VFR
    populateSelect(
      d.fpsSelect,
      FPS_PRESETS.map((f) => ({ value: f.id, label: f.label })),
      s.fpsMode
    );
    d.customFpsInput.hidden = s.fpsMode !== 'custom';
    d.customFpsInput.value = String(s.customFps);
    d.vfrPolicyField.hidden = s.fpsMode !== 'original';
    d.vfrPolicySelect.value = s.vfrPolicy;

    // 6. Audio
    const hasAudio = ins.audioStreams.length > 0;
    d.audioModeSelect.disabled = !hasAudio;
    if (!hasAudio) s.audioMode = 'none';
    d.audioModeSelect.value = s.audioMode;

    const aEncoders = getAvailableAudioEncodersForContainer(s.container, this.#capabilities);
    populateSelect(
      d.audioCodecSelect,
      aEncoders.map((a) => ({ value: a.id, label: a.label })),
      s.audioCodec
    );
    const showAudioEncode = hasAudio && s.audioMode === 'encode';
    d.audioCodecField.hidden = !showAudioEncode;

    const aEnc = AUDIO_ENCODERS[s.audioCodec];
    d.audioBitrateField.hidden = !showAudioEncode || Boolean(aEnc?.lossless);
    if (aEnc && !aEnc.lossless) {
      const presetOpts = [
        { value: '0', label: 'Custom' },
        ...aEnc.presetsKbps.map((k) => ({ value: String(k), label: `${k} Kbps` })),
      ];
      const matchedPreset = aEnc.presetsKbps.includes(Number(s.audioBitrateKbps))
        ? String(s.audioBitrateKbps)
        : '0';
      populateSelect(d.audioBitratePresetSelect, presetOpts, matchedPreset);
      d.audioBitrateInput.min = String(aEnc.minKbps);
      d.audioBitrateInput.max = String(aEnc.maxKbps);
      d.audioBitrateInput.value = String(s.audioBitrateKbps);
    }

    // 7. Advanced options (hide inapplicable controls cleanly)
    d.presetField.hidden = vEnc.presets.length === 0;
    if (vEnc.presets.length > 0) {
      populateSelect(
        d.presetSelect,
        vEnc.presets.map((p) => ({ value: p, label: p })),
        s.preset || vEnc.defaultPreset
      );
    }

    d.profileField.hidden = vEnc.profiles.length === 0;
    if (vEnc.profiles.length > 0) {
      populateSelect(
        d.profileSelect,
        vEnc.profiles.map((p) => ({ value: p, label: p || 'Auto' })),
        s.profile
      );
    }

    d.levelField.hidden = vEnc.levels.length === 0;
    if (vEnc.levels.length > 0) {
      populateSelect(
        d.levelSelect,
        vEnc.levels.map((l) => ({ value: l, label: l || 'Auto' })),
        s.level
      );
    }

    d.pixelFormatField.hidden = vEnc.pixelFormats.length === 0;
    if (vEnc.pixelFormats.length > 0) {
      populateSelect(
        d.pixelFormatSelect,
        vEnc.pixelFormats.map((pf) => ({ value: pf, label: pf || 'Auto' })),
        s.pixelFormat
      );
    }

    d.gopField.hidden = !vEnc.supportsGop;
    d.gopInput.value = s.gopSize;

    d.audioSampleRateField.hidden = !showAudioEncode;
    d.audioChannelsField.hidden = !showAudioEncode;
    if (showAudioEncode && aEnc) {
      populateSelect(
        d.audioSampleRateSelect,
        aEnc.sampleRates.map((sr) => ({
          value: String(sr),
          label: sr === 0 ? 'Original' : `${sr} Hz`,
        })),
        String(s.audioSampleRate)
      );
      d.audioChannelsSelect.value = String(s.audioChannels);
    }

    // Stream selectors
    d.videoStreamField.hidden = ins.videoStreams.length <= 1;
    populateSelect(
      d.videoStreamSelect,
      ins.videoStreams.map((vs) => ({
        value: String(vs.index),
        label: `Video #${vs.index} (${formatField(vs.codec)})`,
      })),
      String(s.videoStreamIndex)
    );

    d.audioStreamField.hidden = ins.audioStreams.length <= 1 || s.audioMode === 'none';
    populateSelect(
      d.audioStreamSelect,
      ins.audioStreams.map((as) => ({
        value: String(as.index),
        label: `Audio #${as.index} (${formatField(as.codec)}${as.language.value ? `, ${as.language.value}` : ''})`,
      })),
      String(s.audioStreamIndex)
    );

    const hasSubs = ins.subtitleStreams.length > 0;
    const containerSpec = getAvailableContainers(this.#capabilities).find(
      (c) => c.id === s.container
    );
    d.subtitleModeField.hidden = !hasSubs || !containerSpec?.subtitleCopyCodec;
    d.subtitleStreamField.hidden =
      !hasSubs || ins.subtitleStreams.length <= 1 || s.subtitleMode !== 'copy';
    if (hasSubs) {
      d.subtitleModeSelect.value = containerSpec?.subtitleCopyCodec ? s.subtitleMode : 'none';
      populateSelect(
        d.subtitleStreamSelect,
        ins.subtitleStreams.map((ss) => ({
          value: String(ss.index),
          label: `Subtitle #${ss.index} (${formatField(ss.codec)}${ss.language.value ? `, ${ss.language.value}` : ''})`,
        })),
        String(s.subtitleStreamIndex)
      );
    }

    d.fastStartField.hidden = !containerSpec?.supportsFastStart;
    d.fastStartCheckbox.checked = Boolean(s.fastStart);

    d.addToQueueBtn.textContent = this.#editingJobId ? 'Save Job Changes' : 'Add to Queue';
    this.#renderValidation();
  }

  #renderValidation() {
    const d = this.#dom;
    const stack = d.validationFeedback;
    stack.textContent = '';

    if (!this.#draftSettings || !this.#currentInspection) {
      d.addToQueueBtn.disabled = true;
      return;
    }

    const res = validateSettings(
      this.#draftSettings,
      this.#currentInspection,
      this.#capabilities
    );

    for (const err of res.errors) {
      stack.appendChild(el('div', 'notice notice-error', err));
    }
    for (const warn of res.warnings) {
      stack.appendChild(el('div', 'notice notice-warning', warn));
    }

    d.addToQueueBtn.disabled = !res.valid;
  }

  renderQueue(jobs, summary) {
    const d = this.#dom;
    const running = this.#queueManager.isRunning;

    d.queueEmptyState.hidden = jobs.length > 0;
    d.overallProgressBox.hidden = jobs.length === 0;

    if (jobs.length === 0) {
      d.queueStatsLine.textContent = 'No jobs queued yet';
    } else {
      d.queueStatsLine.textContent = `${summary.total} total · ${summary.pending} pending · ${summary.completed} completed · ${summary.failed} failed`;
    }

    d.startQueueBtn.disabled = running || summary.pending === 0;
    d.startQueueBtn.textContent = running ? 'Queue Running…' : 'Start Queue';
    d.clearFinishedBtn.disabled = summary.completed + summary.cancelled === 0;

    const overallPct = Math.round(summary.overallProgress * 100);
    d.overallProgressPct.textContent = `${overallPct}%`;
    d.overallProgressFill.style.width = `${overallPct}%`;
    d.overallProgressBarWrap.setAttribute('aria-valuenow', String(overallPct));
    d.overallProgressLabel.textContent = running
      ? `Processing (${summary.completed + 1} of ${summary.total - summary.cancelled})`
      : 'Overall queue progress';

    d.queueList.textContent = '';

    jobs.forEach((job, idx) => {
      const li = el(
        'li',
        `queue-item${job.status === 'processing' ? ' is-processing' : ''}`
      );

      // Top header
      const top = el('div', 'queue-item-top');
      const titleWrap = el('div', 'queue-item-title-wrap');
      titleWrap.appendChild(el('div', 'queue-item-name', job.fileName));
      titleWrap.appendChild(
        el(
          'div',
          'queue-item-sub',
          `${formatBytes(job.fileSize)} → ${job.outputFileName}`
        )
      );
      titleWrap.appendChild(el('div', 'queue-item-sub', summarizeJobSettings(job.settings)));
      top.appendChild(titleWrap);

      const statusLabels = {
        pending: 'Pending',
        processing: `Processing (${Math.round(job.progress * 100)}%)`,
        completed: 'Completed',
        failed: 'Failed',
        cancelled: 'Cancelled',
      };
      top.appendChild(
        el(
          'span',
          `queue-status-text status-${job.status}`,
          statusLabels[job.status] || job.status
        )
      );
      li.appendChild(top);

      // Progress bar for active or completed job
      if (job.status === 'processing' || job.status === 'completed') {
        const pct = job.status === 'completed' ? 100 : Math.round(job.progress * 100);
        const track = el('div', 'progress-track');
        track.setAttribute('role', 'progressbar');
        track.setAttribute('aria-valuemin', '0');
        track.setAttribute('aria-valuemax', '100');
        track.setAttribute('aria-valuenow', String(pct));
        const fill = el('div', 'progress-fill');
        fill.style.width = `${pct}%`;
        track.appendChild(fill);
        li.appendChild(track);
      }

      if (job.phase) {
        const phaseNote = el(
          'div',
          `muted-hint`,
          job.outputSize
            ? `${job.phase} · Output size: ${formatBytes(job.outputSize)}`
            : job.phase
        );
        li.appendChild(phaseNote);
      }

      if (job.error) {
        li.appendChild(el('div', 'notice notice-error', job.error));
      }

      // Action buttons
      const actions = el('div', 'queue-item-actions');

      if (job.status === 'pending') {
        const editBtn = el('button', 'btn btn-secondary btn-sm', 'Edit');
        editBtn.type = 'button';
        editBtn.addEventListener('click', () => this.#loadJobIntoEditor(job));
        actions.appendChild(editBtn);

        const prevPending = idx > 0 && jobs[idx - 1].status === 'pending';
        const upBtn = el('button', 'btn btn-secondary btn-sm', 'Move Up');
        upBtn.type = 'button';
        upBtn.disabled = !prevPending;
        upBtn.addEventListener('click', () =>
          this.#queueManager.movePendingJob(job.id, 'up')
        );
        actions.appendChild(upBtn);

        const nextPending =
          idx < jobs.length - 1 && jobs[idx + 1].status === 'pending';
        const downBtn = el('button', 'btn btn-secondary btn-sm', 'Move Down');
        downBtn.type = 'button';
        downBtn.disabled = !nextPending;
        downBtn.addEventListener('click', () =>
          this.#queueManager.movePendingJob(job.id, 'down')
        );
        actions.appendChild(downBtn);

        const removeBtn = el('button', 'btn btn-danger btn-sm', 'Remove');
        removeBtn.type = 'button';
        removeBtn.addEventListener('click', () => {
          if (this.#editingJobId === job.id) {
            this.#editingJobId = null;
            this.#clearCurrentWorkbench('Removed edited job from queue.');
          }
          this.#queueManager.removeJob(job.id);
        });
        actions.appendChild(removeBtn);
      } else if (job.status === 'processing') {
        const cancelBtn = el('button', 'btn btn-danger btn-sm', 'Cancel Job');
        cancelBtn.type = 'button';
        cancelBtn.addEventListener('click', () =>
          this.#queueManager.cancelActiveJob()
        );
        actions.appendChild(cancelBtn);
      } else if (job.status === 'completed') {
        if (job.outputUrl) {
          const dlLink = el('a', 'btn btn-primary btn-sm', 'Download');
          dlLink.href = job.outputUrl;
          dlLink.download = job.outputFileName;
          actions.appendChild(dlLink);
        }
        const removeBtn = el('button', 'btn btn-secondary btn-sm', 'Remove');
        removeBtn.type = 'button';
        removeBtn.addEventListener('click', () => this.#queueManager.removeJob(job.id));
        actions.appendChild(removeBtn);
      } else if (job.status === 'failed' || job.status === 'cancelled') {
        const retryBtn = el('button', 'btn btn-primary btn-sm', 'Retry');
        retryBtn.type = 'button';
        retryBtn.disabled = running;
        retryBtn.addEventListener('click', () => this.#queueManager.retryJob(job.id));
        actions.appendChild(retryBtn);

        const removeBtn = el('button', 'btn btn-secondary btn-sm', 'Remove');
        removeBtn.type = 'button';
        removeBtn.addEventListener('click', () => this.#queueManager.removeJob(job.id));
        actions.appendChild(removeBtn);
      }

      li.appendChild(actions);

      // Verification & Command Details
      if (job.verification || job.commandArgs) {
        const details = el('details', 'queue-item-details');
        const summaryLabel =
          job.verification?.status === 'verified'
            ? 'Verification Report (Passed)'
            : job.verification?.status === 'warnings'
              ? 'Verification Report (Passed with notes)'
              : job.verification?.status === 'failed'
                ? 'Verification Report (Failed)'
                : 'FFmpeg Command Details';
        details.appendChild(el('summary', '', summaryLabel));

        if (job.verification) {
          const ul = el('ul', 'verify-list');
          for (const c of job.verification.checks) {
            ul.appendChild(el('li', '', `OK: ${c}`));
          }
          for (const w of job.verification.warnings) {
            ul.appendChild(el('li', '', `Note: ${w}`));
          }
          for (const f of job.verification.failures) {
            ul.appendChild(el('li', '', `Fail: ${f}`));
          }
          details.appendChild(ul);
        }

        if (job.commandArgs) {
          details.appendChild(
            el('pre', 'cmd-preview', `ffmpeg ${job.commandArgs.join(' ')}`)
          );
        }

        li.appendChild(details);
      }

      d.queueList.appendChild(li);
    });
  }
}
