import {
  AUDIO_ENCODERS,
  CONTAINERS,
  VIDEO_ENCODERS,
  solveOutputDimensions,
} from './codecs.js';

/**
 * Generates a validated, safe FFmpeg argument array from an immutable job settings snapshot.
 * Never constructs shell command strings.
 */
export function buildFFmpegCommand({
  inputVirtualPath,
  outputVirtualPath,
  settings,
  inspection,
}) {
  const container = CONTAINERS.find((c) => c.id === settings.container);
  const vEnc = VIDEO_ENCODERS[settings.videoCodec];
  if (!container || !vEnc) {
    throw new Error('Invalid container or video encoder configuration.');
  }

  const args = ['-hide_banner', '-y', '-i', inputVirtualPath];

  // Stream mapping
  const vIdx = Number.isInteger(settings.videoStreamIndex) ? settings.videoStreamIndex : 0;
  args.push('-map', `0:v:${vIdx}`);

  const hasAudioStream = (inspection?.audioStreams?.length || 0) > 0;
  const aIdx = Number.isInteger(settings.audioStreamIndex) ? settings.audioStreamIndex : 0;
  if (settings.audioMode !== 'none' && hasAudioStream) {
    args.push('-map', `0:a:${aIdx}`);
  }

  const hasSubStream = (inspection?.subtitleStreams?.length || 0) > 0;
  const sIdx = Number.isInteger(settings.subtitleStreamIndex) ? settings.subtitleStreamIndex : 0;
  if (settings.subtitleMode === 'copy' && hasSubStream && container.subtitleCopyCodec) {
    args.push('-map', `0:s:${sIdx}`);
  }

  // Video filtergraph: scaling + aspect ratio + pixel format
  const videoStream = inspection?.videoStreams?.[vIdx] || inspection?.videoStreams?.[0];
  const dims = solveOutputDimensions({
    videoStream,
    resolutionPreset: settings.resolutionPreset,
    customWidth: settings.customWidth,
    customHeight: settings.customHeight,
    lastEditedDimension: settings.lastEditedDimension,
    aspectRatioMode: settings.aspectRatioMode,
    customAspectWidth: settings.customAspectWidth,
    customAspectHeight: settings.customAspectHeight,
    scalingMode: settings.scalingMode,
    requiresEven: vEnc.requiresEvenDimensions,
  });

  const filters = [];
  if (dims.width && dims.height) {
    const W = dims.width;
    const H = dims.height;
    if (settings.scalingMode === 'crop') {
      filters.push(`scale=${W}:${H}:force_original_aspect_ratio=increase`, `crop=${W}:${H}`, 'setsar=1');
    } else if (settings.scalingMode === 'pad') {
      filters.push(
        `scale=${W}:${H}:force_original_aspect_ratio=decrease`,
        `pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:black`,
        'setsar=1'
      );
    } else if (settings.scalingMode === 'stretch') {
      filters.push(`scale=${W}:${H}`, 'setsar=1');
    } else {
      // preserve aspect ratio; ensure mod-2 on both dimensions if needed
      const roundExpr = vEnc.requiresEvenDimensions
        ? `scale=trunc(iw/2)*2:trunc(ih/2)*2`
        : null;
      filters.push(`scale=${W}:${H}:force_original_aspect_ratio=decrease`);
      if (roundExpr) filters.push(roundExpr);
      filters.push('setsar=1');
    }
  }

  if (settings.pixelFormat) {
    filters.push(`format=${settings.pixelFormat}`);
  }

  if (filters.length > 0) {
    args.push('-vf', filters.join(','));
  }

  // Video codec & rate control
  args.push('-c:v', vEnc.id);

  if (settings.rateControlMode === 'crf' && vEnc.crf) {
    args.push('-crf', String(settings.crf));
    if (vEnc.id === 'libvpx-vp9' || vEnc.id === 'libvpx') {
      args.push('-b:v', '0');
    }
  } else if (settings.rateControlMode === 'qscale' && vEnc.qscale) {
    args.push('-q:v', String(settings.qscale));
  } else {
    const rawVal = Number(settings.videoBitrateValue);
    const kbps = Math.round(settings.videoBitrateUnit === 'mbps' ? rawVal * 1000 : rawVal);
    args.push('-b:v', `${kbps}k`);
    if (settings.rateControlMode === 'cbr') {
      args.push('-minrate', `${kbps}k`, '-maxrate', `${kbps}k`, '-bufsize', `${kbps * 2}k`);
    }
  }

  // Encoder preset / speed
  if (settings.preset && vEnc.presets.includes(settings.preset)) {
    if (vEnc.id === 'libvpx' || vEnc.id === 'libvpx-vp9') {
      args.push('-deadline', settings.preset);
    } else if (vEnc.id === 'libaom-av1') {
      args.push('-cpu-used', settings.preset);
    } else if (vEnc.id === 'libsvtav1') {
      args.push('-preset', settings.preset);
    } else {
      args.push('-preset', settings.preset);
    }
  }

  if (settings.profile && vEnc.profiles.includes(settings.profile)) {
    args.push('-profile:v', settings.profile);
  }

  if (settings.level && vEnc.levels.includes(settings.level)) {
    args.push('-level:v', settings.level);
  }

  if (settings.gopSize !== '' && settings.gopSize !== null && vEnc.supportsGop) {
    args.push('-g', String(Number(settings.gopSize)));
  }

  // Frame rate & VFR policy
  if (settings.fpsMode && settings.fpsMode !== 'original') {
    const targetFps = settings.fpsMode === 'custom' ? Number(settings.customFps) : Number(settings.fpsMode);
    if (Number.isFinite(targetFps) && targetFps > 0) {
      args.push('-r', String(targetFps), '-fps_mode', 'cfr');
    }
  } else if (settings.vfrPolicy === 'cfr') {
    args.push('-fps_mode', 'cfr');
  } else if (videoStream?.fpsMode?.value === 'VFR' && container.id !== 'avi' && container.id !== 'mpeg') {
    args.push('-fps_mode', 'passthrough');
  }

  // Audio handling
  if (settings.audioMode === 'none' || !hasAudioStream) {
    args.push('-an');
  } else if (settings.audioMode === 'copy') {
    args.push('-c:a', 'copy');
  } else {
    const aEnc = AUDIO_ENCODERS[settings.audioCodec];
    if (!aEnc) throw new Error('Invalid audio encoder.');
    args.push('-c:a', aEnc.id);
    if (!aEnc.lossless && settings.audioBitrateKbps) {
      args.push('-b:a', `${Math.round(Number(settings.audioBitrateKbps))}k`);
    }
    if (Number(settings.audioSampleRate) > 0) {
      args.push('-ar', String(Number(settings.audioSampleRate)));
    }
    if (Number(settings.audioChannels) > 0) {
      args.push('-ac', String(Number(settings.audioChannels)));
    }
  }

  // Subtitles
  if (settings.subtitleMode === 'copy' && hasSubStream && container.subtitleCopyCodec) {
    args.push('-c:s', container.subtitleCopyCodec);
  } else {
    args.push('-sn');
  }

  // Container muxing flags
  if (container.supportsFastStart && settings.fastStart) {
    args.push('-movflags', '+faststart');
  }
  args.push('-f', container.muxer, outputVirtualPath);

  return { args, targetDimensions: dims };
}
