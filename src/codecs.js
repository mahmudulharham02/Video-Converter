/**
 * Authoritative container, video encoder, audio encoder compatibility rules,
 * aspect-ratio / resolution solver, and settings validator.
 */

export const CONTAINERS = [
  {
    id: 'mp4',
    label: 'MP4 (.mp4)',
    ext: '.mp4',
    mime: 'video/mp4',
    muxer: 'mp4',
    videoEncoders: ['libx264', 'libx265', 'mpeg4', 'libaom-av1', 'libsvtav1'],
    audioEncoders: ['aac', 'libmp3lame', 'ac3', 'libopus'],
    copyVideoCodecs: ['h264', 'avc', 'hevc', 'h265', 'mpeg4', 'av1'],
    copyAudioCodecs: ['aac', 'mp3', 'ac3', 'opus'],
    supportsFastStart: true,
    subtitleCopyCodec: 'mov_text',
  },
  {
    id: 'mkv',
    label: 'Matroska (.mkv)',
    ext: '.mkv',
    mime: 'video/x-matroska',
    muxer: 'matroska',
    videoEncoders: ['libx264', 'libx265', 'mpeg4', 'mpeg2video', 'libvpx', 'libaom-av1', 'libsvtav1'],
    audioEncoders: ['aac', 'libmp3lame', 'ac3', 'libopus', 'flac', 'libvorbis'],
    copyVideoCodecs: ['h264', 'avc', 'hevc', 'h265', 'mpeg4', 'mpeg2', 'vp8', 'vp9', 'av1'],
    copyAudioCodecs: ['aac', 'mp3', 'ac3', 'opus', 'flac', 'vorbis', 'pcm'],
    supportsFastStart: false,
    subtitleCopyCodec: 'copy',
  },
  {
    id: 'mov',
    label: 'QuickTime (.mov)',
    ext: '.mov',
    mime: 'video/quicktime',
    muxer: 'mov',
    videoEncoders: ['libx264', 'libx265', 'mpeg4'],
    audioEncoders: ['aac', 'libmp3lame', 'ac3'],
    copyVideoCodecs: ['h264', 'avc', 'hevc', 'h265', 'mpeg4'],
    copyAudioCodecs: ['aac', 'mp3', 'ac3', 'pcm'],
    supportsFastStart: true,
    subtitleCopyCodec: 'mov_text',
  },
  {
    id: 'webm',
    label: 'WebM (.webm)',
    ext: '.webm',
    mime: 'video/webm',
    muxer: 'webm',
    videoEncoders: ['libvpx', 'libaom-av1', 'libsvtav1'],
    audioEncoders: ['libopus', 'libvorbis'],
    copyVideoCodecs: ['vp8', 'vp9', 'av1'],
    copyAudioCodecs: ['opus', 'vorbis'],
    supportsFastStart: false,
    subtitleCopyCodec: null,
  },
  {
    id: 'avi',
    label: 'AVI (.avi)',
    ext: '.avi',
    mime: 'video/x-msvideo',
    muxer: 'avi',
    videoEncoders: ['mpeg4', 'libx264', 'mpeg2video'],
    audioEncoders: ['libmp3lame', 'ac3'],
    copyVideoCodecs: ['mpeg4', 'h264', 'avc', 'mpeg2'],
    copyAudioCodecs: ['mp3', 'ac3', 'pcm'],
    supportsFastStart: false,
    subtitleCopyCodec: null,
  },
  {
    id: 'mpeg',
    label: 'MPEG-PS (.mpg)',
    ext: '.mpg',
    mime: 'video/mpeg',
    muxer: 'mpeg',
    videoEncoders: ['mpeg2video', 'mpeg1video'],
    audioEncoders: ['libmp3lame', 'ac3'],
    copyVideoCodecs: ['mpeg1', 'mpeg2'],
    copyAudioCodecs: ['mp2', 'mp3', 'ac3'],
    supportsFastStart: false,
    subtitleCopyCodec: null,
  },
  {
    id: 'ts',
    label: 'MPEG-TS (.ts)',
    ext: '.ts',
    mime: 'video/mp2t',
    muxer: 'mpegts',
    videoEncoders: ['libx264', 'libx265', 'mpeg2video'],
    audioEncoders: ['aac', 'libmp3lame', 'ac3'],
    copyVideoCodecs: ['h264', 'avc', 'hevc', 'h265', 'mpeg2'],
    copyAudioCodecs: ['aac', 'mp3', 'ac3', 'mp2'],
    supportsFastStart: false,
    subtitleCopyCodec: null,
  },
  {
    id: 'wmv',
    label: 'WMV / ASF (.wmv)',
    ext: '.wmv',
    mime: 'video/x-ms-wmv',
    muxer: 'asf',
    videoEncoders: ['wmv2', 'wmv1', 'mpeg4'],
    audioEncoders: ['wmav2', 'libmp3lame'],
    copyVideoCodecs: ['wmv1', 'wmv2', 'wmv3', 'vc1', 'mpeg4'],
    copyAudioCodecs: ['wma', 'wmav2', 'mp3'],
    supportsFastStart: false,
    subtitleCopyCodec: null,
  },
];

export const VIDEO_ENCODERS = {
  libx264: {
    id: 'libx264',
    label: 'H.264 / AVC (libx264)',
    family: 'h264',
    rateControls: ['crf', 'vbr', 'cbr'],
    defaultRateControl: 'crf',
    crf: { min: 0, max: 51, default: 23, label: 'CRF (0 lossless – 51 lowest)' },
    presets: ['ultrafast', 'superfast', 'veryfast', 'faster', 'fast', 'medium', 'slow', 'slower', 'veryslow'],
    defaultPreset: 'medium',
    profiles: ['', 'baseline', 'main', 'high', 'high10'],
    levels: ['', '3.0', '3.1', '4.0', '4.1', '4.2', '5.0', '5.1', '5.2'],
    pixelFormats: ['', 'yuv420p', 'yuv422p', 'yuv444p'],
    defaultPixelFormat: 'yuv420p',
    requiresEvenDimensions: true,
    supportsGop: true,
  },
  libx265: {
    id: 'libx265',
    label: 'H.265 / HEVC (libx265)',
    family: 'hevc',
    rateControls: ['crf', 'vbr'],
    defaultRateControl: 'crf',
    crf: { min: 0, max: 51, default: 28, label: 'CRF (0 lossless – 51 lowest)' },
    presets: ['ultrafast', 'superfast', 'veryfast', 'faster', 'fast', 'medium', 'slow', 'slower'],
    defaultPreset: 'medium',
    profiles: ['', 'main', 'main10'],
    levels: ['', '3.1', '4.0', '4.1', '5.0', '5.1'],
    pixelFormats: ['', 'yuv420p', 'yuv420p10le', 'yuv422p', 'yuv444p'],
    defaultPixelFormat: 'yuv420p',
    requiresEvenDimensions: true,
    supportsGop: true,
  },
  mpeg4: {
    id: 'mpeg4',
    label: 'MPEG-4 Part 2 (mpeg4)',
    family: 'mpeg4',
    rateControls: ['vbr', 'cbr', 'qscale'],
    defaultRateControl: 'vbr',
    qscale: { min: 2, max: 31, default: 5, label: 'Quantizer q:v (2 best – 31 lowest)' },
    presets: [],
    profiles: [],
    levels: [],
    pixelFormats: ['', 'yuv420p'],
    defaultPixelFormat: 'yuv420p',
    requiresEvenDimensions: true,
    supportsGop: true,
  },
  mpeg2video: {
    id: 'mpeg2video',
    label: 'MPEG-2 (mpeg2video)',
    family: 'mpeg2',
    rateControls: ['vbr', 'cbr', 'qscale'],
    defaultRateControl: 'vbr',
    qscale: { min: 2, max: 31, default: 4, label: 'Quantizer q:v (2 best – 31 lowest)' },
    presets: [],
    profiles: ['', 'main', 'high'],
    levels: [],
    pixelFormats: ['', 'yuv420p', 'yuv422p'],
    defaultPixelFormat: 'yuv420p',
    requiresEvenDimensions: true,
    supportsGop: true,
  },
  mpeg1video: {
    id: 'mpeg1video',
    label: 'MPEG-1 (mpeg1video)',
    family: 'mpeg1',
    rateControls: ['vbr', 'cbr', 'qscale'],
    defaultRateControl: 'vbr',
    qscale: { min: 2, max: 31, default: 4, label: 'Quantizer q:v (2 best – 31 lowest)' },
    presets: [],
    profiles: [],
    levels: [],
    pixelFormats: ['', 'yuv420p'],
    defaultPixelFormat: 'yuv420p',
    requiresEvenDimensions: true,
    supportsGop: true,
  },
  'libvpx-vp9': {
    id: 'libvpx-vp9',
    label: 'VP9 (libvpx-vp9)',
    family: 'vp9',
    rateControls: ['crf', 'vbr', 'cbr'],
    defaultRateControl: 'crf',
    crf: { min: 0, max: 63, default: 31, label: 'CRF (0 lossless – 63 lowest)' },
    presets: ['realtime', 'good', 'best'],
    defaultPreset: 'good',
    profiles: ['', '0', '1', '2'],
    levels: [],
    pixelFormats: ['', 'yuv420p', 'yuv422p', 'yuv444p'],
    defaultPixelFormat: 'yuv420p',
    requiresEvenDimensions: true,
    supportsGop: true,
  },
  libvpx: {
    id: 'libvpx',
    label: 'VP8 (libvpx)',
    family: 'vp8',
    rateControls: ['crf', 'vbr', 'cbr'],
    defaultRateControl: 'vbr',
    crf: { min: 4, max: 63, default: 20, label: 'CRF (4 highest – 63 lowest)' },
    presets: ['realtime', 'good', 'best'],
    defaultPreset: 'good',
    profiles: [],
    levels: [],
    pixelFormats: ['', 'yuv420p'],
    defaultPixelFormat: 'yuv420p',
    requiresEvenDimensions: true,
    supportsGop: true,
  },
  'libaom-av1': {
    id: 'libaom-av1',
    label: 'AV1 (libaom-av1)',
    family: 'av1',
    rateControls: ['crf', 'vbr'],
    defaultRateControl: 'crf',
    crf: { min: 0, max: 63, default: 32, label: 'CRF (0 lossless – 63 lowest)' },
    presets: ['4', '5', '6', '7', '8'],
    defaultPreset: '6',
    profiles: ['', 'main', 'high'],
    levels: [],
    pixelFormats: ['', 'yuv420p', 'yuv420p10le'],
    defaultPixelFormat: 'yuv420p',
    requiresEvenDimensions: true,
    supportsGop: true,
  },
  'libsvtav1': {
    id: 'libsvtav1',
    label: 'AV1 (libsvtav1)',
    family: 'av1',
    rateControls: ['crf', 'vbr'],
    defaultRateControl: 'crf',
    crf: { min: 0, max: 63, default: 30, label: 'CRF (0 lossless – 63 lowest)' },
    presets: ['4', '6', '8', '10', '12'],
    defaultPreset: '8',
    profiles: ['', 'main'],
    levels: [],
    pixelFormats: ['', 'yuv420p', 'yuv420p10le'],
    defaultPixelFormat: 'yuv420p',
    requiresEvenDimensions: true,
    supportsGop: true,
  },
  wmv2: {
    id: 'wmv2',
    label: 'WMV8 (wmv2)',
    family: 'wmv2',
    rateControls: ['vbr', 'cbr'],
    defaultRateControl: 'vbr',
    presets: [],
    profiles: [],
    levels: [],
    pixelFormats: ['', 'yuv420p'],
    defaultPixelFormat: 'yuv420p',
    requiresEvenDimensions: true,
    supportsGop: true,
  },
  wmv1: {
    id: 'wmv1',
    label: 'WMV7 (wmv1)',
    family: 'wmv1',
    rateControls: ['vbr', 'cbr'],
    defaultRateControl: 'vbr',
    presets: [],
    profiles: [],
    levels: [],
    pixelFormats: ['', 'yuv420p'],
    defaultPixelFormat: 'yuv420p',
    requiresEvenDimensions: true,
    supportsGop: true,
  },
};

export const AUDIO_ENCODERS = {
  aac: {
    id: 'aac',
    label: 'AAC (native)',
    family: 'aac',
    minKbps: 32,
    maxKbps: 512,
    defaultKbps: 160,
    presetsKbps: [64, 96, 128, 160, 192, 256, 320],
    sampleRates: [0, 22050, 44100, 48000, 96000],
    maxChannels: 6,
  },
  libmp3lame: {
    id: 'libmp3lame',
    label: 'MP3 (libmp3lame)',
    family: 'mp3',
    minKbps: 32,
    maxKbps: 320,
    defaultKbps: 192,
    presetsKbps: [64, 96, 128, 192, 256, 320],
    sampleRates: [0, 22050, 44100, 48000],
    maxChannels: 2,
  },
  ac3: {
    id: 'ac3',
    label: 'AC3 / Dolby Digital (ac3)',
    family: 'ac3',
    minKbps: 96,
    maxKbps: 640,
    defaultKbps: 256,
    presetsKbps: [128, 192, 256, 384, 448, 640],
    sampleRates: [0, 32000, 44100, 48000],
    maxChannels: 6,
  },
  libopus: {
    id: 'libopus',
    label: 'Opus (libopus)',
    family: 'opus',
    minKbps: 16,
    maxKbps: 510,
    defaultKbps: 128,
    presetsKbps: [48, 64, 96, 128, 160, 192, 256],
    sampleRates: [0, 48000],
    maxChannels: 6,
  },
  flac: {
    id: 'flac',
    label: 'FLAC Lossless (flac)',
    family: 'flac',
    lossless: true,
    minKbps: null,
    maxKbps: null,
    defaultKbps: null,
    presetsKbps: [],
    sampleRates: [0, 44100, 48000, 96000],
    maxChannels: 6,
  },
  libvorbis: {
    id: 'libvorbis',
    label: 'Vorbis (libvorbis)',
    family: 'vorbis',
    minKbps: 48,
    maxKbps: 500,
    defaultKbps: 160,
    presetsKbps: [64, 96, 128, 160, 192, 256, 320],
    sampleRates: [0, 22050, 44100, 48000],
    maxChannels: 6,
  },
  wmav2: {
    id: 'wmav2',
    label: 'WMA v2 (wmav2)',
    family: 'wma',
    minKbps: 48,
    maxKbps: 320,
    defaultKbps: 160,
    presetsKbps: [64, 96, 128, 160, 192, 256],
    sampleRates: [0, 22050, 44100, 48000],
    maxChannels: 2,
  },
};

export const RESOLUTION_PRESETS = [
  { id: 'original', label: 'Original', width: null, height: null },
  { id: '2160p', label: '4K UHD (2160p)', width: 3840, height: 2160 },
  { id: '1440p', label: '1440p QHD', width: 2560, height: 1440 },
  { id: '1080p', label: '1080p Full HD', width: 1920, height: 1080 },
  { id: '720p', label: '720p HD', width: 1280, height: 720 },
  { id: '480p', label: '480p SD', width: 854, height: 480 },
  { id: '360p', label: '360p', width: 640, height: 360 },
  { id: 'custom', label: 'Custom dimensions', width: null, height: null },
];

export const ASPECT_RATIO_OPTIONS = [
  { id: 'original', label: 'Original', ratio: null },
  { id: '16:9', label: '16:9 (Widescreen)', ratio: 16 / 9 },
  { id: '4:3', label: '4:3 (Standard)', ratio: 4 / 3 },
  { id: '1:1', label: '1:1 (Square)', ratio: 1 },
  { id: '9:16', label: '9:16 (Vertical)', ratio: 9 / 16 },
  { id: '21:9', label: '21:9 (Ultrawide)', ratio: 21 / 9 },
  { id: 'custom', label: 'Custom ratio', ratio: null },
];

export const SCALING_MODES = [
  {
    id: 'preserve',
    label: 'Preserve aspect ratio',
    description: 'Fits inside target dimensions without cropping or distortion.',
  },
  {
    id: 'crop',
    label: 'Crop to fill',
    description: 'Scales up and center-crops edges to match exact target frame.',
  },
  {
    id: 'pad',
    label: 'Pad to fit',
    description: 'Scales proportionally and adds black letterbox/pillarbox bars.',
  },
  {
    id: 'stretch',
    label: 'Stretch',
    description: 'Forces exact target width and height (can distort image).',
  },
];

export const FPS_PRESETS = [
  { id: 'original', label: 'Preserve original', fps: null },
  { id: '23.976', label: '23.976 fps (Film)', fps: 23.976 },
  { id: '24', label: '24 fps', fps: 24 },
  { id: '25', label: '25 fps (PAL)', fps: 25 },
  { id: '29.97', label: '29.97 fps (NTSC)', fps: 29.97 },
  { id: '30', label: '30 fps', fps: 30 },
  { id: '50', label: '50 fps', fps: 50 },
  { id: '60', label: '60 fps', fps: 60 },
  { id: 'custom', label: 'Custom FPS', fps: null },
];

export function normalizeCodecToken(rawCodec) {
  const s = String(rawCodec || '').toLowerCase().trim();
  if (!s) return '';
  if (s.includes('264') || s.includes('avc')) return 'h264';
  if (s.includes('265') || s.includes('hevc') || s.includes('hvc1') || s.includes('hev1')) return 'hevc';
  if (s.includes('vp9')) return 'vp9';
  if (s.includes('vp8')) return 'vp8';
  if (s.includes('av1') || s.includes('av01')) return 'av1';
  if (s.includes('mpeg-4') || s.includes('mpeg4') || s.includes('mp4v') || s.includes('xvid') || s.includes('divx')) return 'mpeg4';
  if (s.includes('mpeg-2') || s.includes('mpeg2')) return 'mpeg2';
  if (s.includes('mpeg-1') || s.includes('mpeg1')) return 'mpeg1';
  if (s.includes('wmv3') || s.includes('vc-1') || s.includes('vc1')) return 'vc1';
  if (s.includes('wmv2')) return 'wmv2';
  if (s.includes('wmv1')) return 'wmv1';
  if (s.includes('aac') || s.includes('mp4a')) return 'aac';
  if (s.includes('opus')) return 'opus';
  if (s.includes('vorbis')) return 'vorbis';
  if (s.includes('flac')) return 'flac';
  if (s.includes('ac-3') || s.includes('ac3')) return 'ac3';
  if (s.includes('mp3') || s.includes('mpeg audio') || s.includes('lame')) return 'mp3';
  if (s.includes('mp2')) return 'mp2';
  if (s.includes('pcm')) return 'pcm';
  if (s.includes('wmav2') || s.includes('wma')) return 'wma';
  return s;
}

export function getAvailableContainers(capabilities) {
  const muxers = capabilities?.muxers;
  if (!muxers || muxers.size === 0) {
    return CONTAINERS;
  }
  return CONTAINERS.filter((c) => muxers.has(c.muxer));
}

export function getAvailableVideoEncodersForContainer(containerId, capabilities) {
  const container = CONTAINERS.find((c) => c.id === containerId);
  if (!container) return [];
  const available = capabilities?.encoders?.video;
  return container.videoEncoders
    .filter((id) => !available || available.size === 0 || available.has(id))
    .map((id) => VIDEO_ENCODERS[id])
    .filter(Boolean);
}

export function getAvailableAudioEncodersForContainer(containerId, capabilities) {
  const container = CONTAINERS.find((c) => c.id === containerId);
  if (!container) return [];
  const available = capabilities?.encoders?.audio;
  return container.audioEncoders
    .filter((id) => !available || available.size === 0 || available.has(id))
    .map((id) => AUDIO_ENCODERS[id])
    .filter(Boolean);
}

export function getEffectiveSourceDimensions(videoStream) {
  if (!videoStream) {
    return { width: null, height: null, dar: null, rotated: false };
  }
  const rawW = videoStream.width?.value ?? null;
  const rawH = videoStream.height?.value ?? null;
  if (!rawW || !rawH) {
    return { width: null, height: null, dar: null, rotated: false };
  }
  const rot = Math.abs(Math.round(videoStream.rotationDeg?.value || 0)) % 360;
  const rotated = rot === 90 || rot === 270;
  const sar = videoStream.sampleAspectRatio?.value || 1;
  const effW = rotated ? rawH : rawW;
  const effH = rotated ? rawW : rawH;
  const dar = (effW * (rotated ? 1 : sar)) / (effH * (rotated ? sar : 1));
  return {
    width: Math.round(effW),
    height: Math.round(effH),
    dar: Number.isFinite(dar) && dar > 0 ? dar : effW / effH,
    rotated,
  };
}

export function roundDimension(val, requireEven = true) {
  const n = Math.round(Number(val));
  if (!Number.isFinite(n) || n < 2) return 2;
  if (!requireEven) return n;
  const even = Math.round(n / 2) * 2;
  return Math.max(2, even);
}

export function getTargetAspectRatioValue(aspectRatioMode, customAspectWidth, customAspectHeight, sourceDar) {
  if (aspectRatioMode === 'original') return sourceDar || 16 / 9;
  if (aspectRatioMode === 'custom') {
    const cw = Number(customAspectWidth);
    const ch = Number(customAspectHeight);
    if (cw > 0 && ch > 0) return cw / ch;
    return sourceDar || 16 / 9;
  }
  const found = ASPECT_RATIO_OPTIONS.find((opt) => opt.id === aspectRatioMode);
  return found?.ratio || sourceDar || 16 / 9;
}

/**
 * Computes exact output width and height honoring:
 * - Source dimensions, rotation, and SAR/DAR
 * - Selected resolution preset or custom width/height input
 * - Selected aspect ratio + scaling mode
 * - Mod-2 encoder requirement
 */
export function solveOutputDimensions({
  videoStream,
  resolutionPreset,
  customWidth,
  customHeight,
  lastEditedDimension = 'width',
  aspectRatioMode = 'original',
  customAspectWidth = 16,
  customAspectHeight = 9,
  scalingMode = 'preserve',
  requiresEven = true,
}) {
  const src = getEffectiveSourceDimensions(videoStream);
  const sourceDar = src.dar || 16 / 9;
  const targetRatio = getTargetAspectRatioValue(
    aspectRatioMode,
    customAspectWidth,
    customAspectHeight,
    sourceDar
  );

  // Determine bounding box from preset or custom inputs
  if (resolutionPreset === 'original' && aspectRatioMode === 'original') {
    if (src.width && src.height) {
      return {
        width: roundDimension(src.width, requiresEven),
        height: roundDimension(src.height, requiresEven),
        isOriginal: true,
        targetRatio: sourceDar,
      };
    }
  }

  let boxW = null;
  let boxH = null;

  const preset = RESOLUTION_PRESETS.find((p) => p.id === resolutionPreset);
  if (preset && preset.width && preset.height) {
    // Fit within the preset box using source or target ratio
    if (aspectRatioMode === 'original') {
      const boxRatio = preset.width / preset.height;
      if (sourceDar >= boxRatio) {
        boxW = preset.width;
        boxH = preset.width / sourceDar;
      } else {
        boxH = preset.height;
        boxW = preset.height * sourceDar;
      }
    } else {
      // Explicit target aspect ratio inside preset tier (using preset height as anchor for landscape, or width for portrait)
      if (targetRatio >= 1) {
        boxH = preset.height;
        boxW = preset.height * targetRatio;
      } else {
        boxW = preset.height;
        boxH = preset.height / targetRatio;
      }
    }
  } else if (resolutionPreset === 'original') {
    // Original resolution tier, but aspect ratio changed (crop/pad/stretch)
    if (src.width && src.height) {
      if (scalingMode === 'crop') {
        if (sourceDar > targetRatio) {
          boxH = src.height;
          boxW = src.height * targetRatio;
        } else {
          boxW = src.width;
          boxH = src.width / targetRatio;
        }
      } else {
        if (sourceDar > targetRatio) {
          boxW = src.width;
          boxH = src.width / targetRatio;
        } else {
          boxH = src.height;
          boxW = src.height * targetRatio;
        }
      }
    }
  } else {
    // Custom dimensions
    const wNum = Number(customWidth);
    const hNum = Number(customHeight);
    const ratioForAuto = scalingMode === 'stretch' && wNum > 0 && hNum > 0 ? wNum / hNum : targetRatio;

    if (lastEditedDimension === 'height' && hNum > 0) {
      boxH = hNum;
      boxW = scalingMode === 'stretch' && wNum > 0 ? wNum : hNum * ratioForAuto;
    } else if (wNum > 0) {
      boxW = wNum;
      boxH = scalingMode === 'stretch' && hNum > 0 ? hNum : wNum / ratioForAuto;
    } else if (hNum > 0) {
      boxH = hNum;
      boxW = hNum * ratioForAuto;
    } else if (src.width && src.height) {
      boxW = src.width;
      boxH = src.height;
    }
  }

  if (!boxW || !boxH) {
    return { width: null, height: null, isOriginal: false, targetRatio };
  }

  // If scalingMode === 'preserve' and user set custom aspect ratio, ensure non-distorted bounding size
  const outW = roundDimension(boxW, requiresEven);
  const outH = roundDimension(boxH, requiresEven);

  return {
    width: outW,
    height: outH,
    isOriginal: false,
    targetRatio,
  };
}

export function createDefaultSettings(inspection, capabilities) {
  const containers = getAvailableContainers(capabilities);
  const defaultContainer = containers.find((c) => c.id === 'mp4') || containers[0] || CONTAINERS[0];
  const videoEncoders = getAvailableVideoEncodersForContainer(defaultContainer.id, capabilities);
  const defaultVideoEnc = videoEncoders.find((e) => e.id === 'libx264') || videoEncoders[0] || VIDEO_ENCODERS.libx264;
  const audioEncoders = getAvailableAudioEncodersForContainer(defaultContainer.id, capabilities);
  const defaultAudioEnc = audioEncoders.find((e) => e.id === 'aac') || audioEncoders[0] || AUDIO_ENCODERS.aac;

  const hasAudio = (inspection?.audioStreams?.length || 0) > 0;
  const firstVideo = inspection?.videoStreams?.[0] || null;
  const eff = getEffectiveSourceDimensions(firstVideo);

  return {
    container: defaultContainer.id,
    videoCodec: defaultVideoEnc.id,
    rateControlMode: defaultVideoEnc.defaultRateControl,
    crf: defaultVideoEnc.crf?.default ?? 23,
    qscale: defaultVideoEnc.qscale?.default ?? 4,
    videoBitrateValue: 2500,
    videoBitrateUnit: 'kbps', // 'kbps' | 'mbps'

    audioMode: hasAudio ? 'encode' : 'none', // 'encode' | 'copy' | 'none'
    audioCodec: defaultAudioEnc.id,
    audioBitrateKbps: defaultAudioEnc.defaultKbps ?? 160,
    audioSampleRate: 0, // 0 = original
    audioChannels: 0, // 0 = original

    resolutionPreset: 'original',
    customWidth: eff.width || 1280,
    customHeight: eff.height || 720,
    lastEditedDimension: 'width',
    aspectRatioMode: 'original',
    customAspectWidth: 16,
    customAspectHeight: 9,
    scalingMode: 'preserve',

    fpsMode: 'original', // 'original' | '23.976' | ... | 'custom'
    customFps: firstVideo?.fps?.value || 30,
    vfrPolicy: 'preserve', // 'preserve' | 'cfr'

    preset: defaultVideoEnc.defaultPreset || '',
    profile: '',
    level: '',
    pixelFormat: defaultVideoEnc.defaultPixelFormat || '',
    gopSize: '',

    videoStreamIndex: 0,
    audioStreamIndex: 0,
    subtitleMode: 'none', // 'none' | 'copy'
    subtitleStreamIndex: 0,
    fastStart: true,
  };
}

export function validateSettings(settings, inspection, capabilities) {
  const errors = [];
  const warnings = [];

  if (!inspection) {
    errors.push('Select and inspect a source video file first.');
    return { valid: false, errors, warnings };
  }

  if ((inspection.videoStreams?.length || 0) === 0) {
    errors.push('The selected file contains no detected video stream.');
  }

  const container = CONTAINERS.find((c) => c.id === settings.container);
  if (!container) {
    errors.push(`Unsupported output container "${settings.container}".`);
    return { valid: false, errors, warnings };
  }

  if (capabilities?.muxers?.size > 0 && !capabilities.muxers.has(container.muxer)) {
    errors.push(`Container "${container.label}" muxer (${container.muxer}) is not available in this FFmpeg build.`);
  }

  const vEnc = VIDEO_ENCODERS[settings.videoCodec];
  if (!vEnc) {
    errors.push(`Unknown video encoder "${settings.videoCodec}".`);
  } else {
    if (!container.videoEncoders.includes(vEnc.id)) {
      errors.push(`${vEnc.label} is not compatible with ${container.label}.`);
    }
    if (capabilities?.encoders?.video?.size > 0 && !capabilities.encoders.video.has(vEnc.id)) {
      errors.push(`Video encoder "${vEnc.id}" is not compiled into the active FFmpeg.wasm build.`);
    }

    if (!vEnc.rateControls.includes(settings.rateControlMode)) {
      errors.push(`Rate-control mode "${settings.rateControlMode}" is not supported by ${vEnc.label}.`);
    } else if (settings.rateControlMode === 'crf') {
      const crfVal = Number(settings.crf);
      if (!Number.isFinite(crfVal) || crfVal < vEnc.crf.min || crfVal > vEnc.crf.max) {
        errors.push(`CRF must be between ${vEnc.crf.min} and ${vEnc.crf.max} for ${vEnc.label}.`);
      }
    } else if (settings.rateControlMode === 'qscale') {
      const qVal = Number(settings.qscale);
      if (!Number.isFinite(qVal) || qVal < vEnc.qscale.min || qVal > vEnc.qscale.max) {
        errors.push(`Quantizer must be between ${vEnc.qscale.min} and ${vEnc.qscale.max} for ${vEnc.label}.`);
      }
    } else {
      const rawVal = Number(settings.videoBitrateValue);
      const kbps = settings.videoBitrateUnit === 'mbps' ? rawVal * 1000 : rawVal;
      if (!Number.isFinite(kbps) || kbps < 50 || kbps > 200000) {
        errors.push('Video bitrate must be between 50 Kbps and 200,000 Kbps (200 Mbps).');
      }
    }

    if (settings.gopSize !== '' && settings.gopSize !== null) {
      const gop = Number(settings.gopSize);
      if (!Number.isInteger(gop) || gop < 1 || gop > 600) {
        errors.push('Keyframe interval (GOP size) must be an integer between 1 and 600.');
      }
    }
  }

  // Validate dimensions
  const videoStream = inspection.videoStreams?.[settings.videoStreamIndex] || inspection.videoStreams?.[0];
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
    requiresEven: vEnc?.requiresEvenDimensions ?? true,
  });

  if (!dims.width || !dims.height) {
    errors.push('Target resolution width and height must be positive numbers.');
  } else {
    if (dims.width < 16 || dims.height < 16 || dims.width > 7680 || dims.height > 4320) {
      errors.push('Target resolution must be between 16x16 and 7680x4320.');
    }
    if ((vEnc?.requiresEvenDimensions ?? true) && (dims.width % 2 !== 0 || dims.height % 2 !== 0)) {
      errors.push(`${vEnc?.label || 'Selected encoder'} requires even width and height dimensions.`);
    }
    if (dims.width > 1920 || dims.height > 1080) {
      warnings.push('Encoding above 1080p in browser WebAssembly is slow and memory-intensive.');
    }
  }

  // Validate aspect ratio custom fields
  if (settings.aspectRatioMode === 'custom') {
    const aw = Number(settings.customAspectWidth);
    const ah = Number(settings.customAspectHeight);
    if (!Number.isFinite(aw) || !Number.isFinite(ah) || aw <= 0 || ah <= 0) {
      errors.push('Custom aspect ratio components must be positive numbers.');
    }
  }

  // Validate FPS
  if (settings.fpsMode === 'custom') {
    const fps = Number(settings.customFps);
    if (!Number.isFinite(fps) || fps < 1 || fps > 240) {
      errors.push('Custom frame rate must be between 1 and 240 fps.');
    }
  }

  // Validate Audio
  const audioStream = inspection.audioStreams?.[settings.audioStreamIndex] || null;
  if (settings.audioMode === 'encode') {
    if (!audioStream) {
      warnings.push('No audio stream exists in source; output will contain video only.');
    } else {
      const aEnc = AUDIO_ENCODERS[settings.audioCodec];
      if (!aEnc) {
        errors.push(`Unknown audio encoder "${settings.audioCodec}".`);
      } else {
        if (!container.audioEncoders.includes(aEnc.id)) {
          errors.push(`Audio codec ${aEnc.label} is not compatible with ${container.label}.`);
        }
        if (capabilities?.encoders?.audio?.size > 0 && !capabilities.encoders.audio.has(aEnc.id)) {
          errors.push(`Audio encoder "${aEnc.id}" is not compiled into the active FFmpeg.wasm build.`);
        }
        if (!aEnc.lossless) {
          const aKbps = Number(settings.audioBitrateKbps);
          if (!Number.isFinite(aKbps) || aKbps < aEnc.minKbps || aKbps > aEnc.maxKbps) {
            errors.push(
              `${aEnc.label} audio bitrate must be between ${aEnc.minKbps} and ${aEnc.maxKbps} Kbps.`
            );
          }
        }
        const ch = Number(settings.audioChannels || 0);
        if (ch > aEnc.maxChannels) {
          errors.push(`${aEnc.label} supports at most ${aEnc.maxChannels} audio channels.`);
        }
      }
    }
  } else if (settings.audioMode === 'copy') {
    if (!audioStream) {
      warnings.push('No audio stream exists in source to preserve.');
    } else {
      const normAudio = normalizeCodecToken(audioStream.codec?.value);
      if (!normAudio) {
        warnings.push('Source audio codec could not be determined; stream copy may fail if incompatible with output container.');
      } else if (!container.copyAudioCodecs.includes(normAudio)) {
        errors.push(
          `Cannot preserve original "${audioStream.codec?.value}" audio inside ${container.label}. Choose Re-encode audio or Remove audio.`
        );
      }
    }
  }

  // Subtitles
  if (settings.subtitleMode === 'copy') {
    if ((inspection.subtitleStreams?.length || 0) === 0) {
      warnings.push('No subtitle stream found in source; subtitle copy will be skipped.');
    } else if (!container.subtitleCopyCodec) {
      errors.push(`${container.label} does not support copying subtitle streams.`);
    }
  }

  // VFR notice
  if (videoStream?.fpsMode?.value === 'VFR' && settings.fpsMode === 'original' && settings.vfrPolicy === 'preserve') {
    if (container.id === 'avi' || container.id === 'mpeg') {
      warnings.push(`${container.label} handles variable-frame-rate timing poorly; consider MP4/MKV or forcing CFR.`);
    }
  }

  // Encoder speed warning
  if (settings.videoCodec === 'libaom-av1' || settings.videoCodec === 'libx265') {
    warnings.push(`${VIDEO_ENCODERS[settings.videoCodec].label} is CPU-intensive in WebAssembly and encodes noticeably slower than H.264.`);
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    computedDimensions: dims,
  };
}
