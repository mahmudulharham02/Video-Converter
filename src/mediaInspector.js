import mediaInfoFactory from 'mediainfo.js';

function resolveMediaInfoWasm() {
  return new URL('vendor/mediainfo/MediaInfoModule.wasm', document.baseURI).href;
}

export function makeField(value, missingStatus = 'missing') {
  if (value === null || value === undefined || value === '' || Number.isNaN(value)) {
    return { value: null, status: missingStatus };
  }
  return { value, status: 'known' };
}

export function formatField(field, formatter = (v) => String(v)) {
  if (!field || field.value === null || field.value === undefined) {
    if (field?.status === 'unknown') return 'Unknown';
    if (field?.status === 'undetermined') return 'Cannot be determined';
    return 'Missing';
  }
  return formatter(field.value);
}

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return 'Cannot be determined';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let val = bytes / 1024;
  let i = 0;
  while (val >= 1024 && i < units.length - 1) {
    val /= 1024;
    i += 1;
  }
  return `${val.toFixed(val >= 100 ? 0 : val >= 10 ? 1 : 2)} ${units[i]}`;
}

export function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return 'Cannot be determined';
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  if (hrs > 0) {
    return `${hrs}:${String(mins).padStart(2, '0')}:${secs.toFixed(1).padStart(4, '0')}`;
  }
  return `${mins}:${secs.toFixed(2).padStart(5, '0')}`;
}

export function formatBitrate(bps) {
  if (!Number.isFinite(bps) || bps <= 0) return 'Cannot be determined';
  if (bps >= 1_000_000) return `${(bps / 1_000_000).toFixed(2)} Mbps`;
  return `${Math.round(bps / 1000)} Kbps`;
}

function parseNumberOrNull(val) {
  if (val === null || val === undefined || val === '') return null;
  const n = Number(val);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function parseFractionOrFloat(str) {
  if (!str || typeof str !== 'string') return parseNumberOrNull(str);
  if (str.includes('/')) {
    const [a, b] = str.split('/').map(Number);
    if (Number.isFinite(a) && Number.isFinite(b) && b > 0) {
      return a / b;
    }
    return null;
  }
  return parseNumberOrNull(str);
}

function parseFFmpegLogsFallback(logs) {
  const streams = [];
  let durationSec = null;
  let bitrateBps = null;
  let container = null;

  for (const line of logs || []) {
    const inputMatch = /Input #0,\s*([^,]+),/.exec(line);
    if (inputMatch) {
      container = inputMatch[1].trim();
    }
    const durMatch = /Duration:\s*(\d+):(\d+):([\d.]+).*?bitrate:\s*(\d+)\s*kb\/s/i.exec(line);
    if (durMatch) {
      durationSec = Number(durMatch[1]) * 3600 + Number(durMatch[2]) * 60 + Number(durMatch[3]);
      bitrateBps = Number(durMatch[4]) * 1000;
    }
    const streamMatch = /Stream #0:(\d+)(?:\[[^\]]+\])?(?:\(([^)]+)\))?:\s*(Video|Audio|Subtitle):\s*([^,]+)(.*)/i.exec(line);
    if (streamMatch) {
      const idx = Number(streamMatch[1]);
      const lang = streamMatch[2] || null;
      const type = streamMatch[3].toLowerCase();
      const codec = streamMatch[4].trim().split(/\s+/)[0];
      const rest = streamMatch[5] || '';
      const info = { index: idx, codec_type: type, codec_name: codec, tags: lang ? { language: lang } : {} };

      if (type === 'video') {
        const resMatch = /(\d{2,5})x(\d{2,5})/.exec(rest);
        if (resMatch) {
          info.width = Number(resMatch[1]);
          info.height = Number(resMatch[2]);
        }
        const pixMatch = /,\s*(yuv[a-z0-9]+|rgb[a-z0-9]+|gray[a-z0-9]*)/i.exec(rest);
        if (pixMatch) info.pix_fmt = pixMatch[1];
        const fpsMatch = /([\d.]+)\s*fps/i.exec(rest);
        if (fpsMatch) info.avg_frame_rate = fpsMatch[1];
      } else if (type === 'audio') {
        const srMatch = /(\d+)\s*Hz/i.exec(rest);
        if (srMatch) info.sample_rate = Number(srMatch[1]);
        if (/\bmono\b/i.test(rest)) info.channels = 1;
        else if (/\bstereo\b/i.test(rest)) info.channels = 2;
        else if (/5\.1/.test(rest)) info.channels = 6;
      }
      streams.push(info);
    }
  }

  return {
    format: { format_name: container, duration: durationSec, bit_rate: bitrateBps },
    streams,
  };
}

async function analyzeWithMediaInfo(fileOrBlob) {
  let mediainfo = null;
  try {
    mediainfo = await mediaInfoFactory({
      format: 'object',
      locateFile: (fileName, prefix) => {
        if (fileName.endsWith('.wasm')) return resolveMediaInfoWasm();
        return prefix + fileName;
      },
    });

    const getSize = () => fileOrBlob.size;
    const readChunk = async (chunkSize, offset) => {
      const slice = fileOrBlob.slice(offset, offset + chunkSize);
      const buf = await slice.arrayBuffer();
      return new Uint8Array(buf);
    };

    const result = await mediainfo.analyzeData(getSize, readChunk);
    return result?.media?.track || [];
  } finally {
    if (mediainfo) {
      try {
        mediainfo.close();
      } catch {
        // ignore
      }
    }
  }
}

export async function inspectMedia(fileOrBlob, displayFileName, ffmpegClient = null) {
  const errors = [];
  let tracks = [];
  try {
    tracks = await analyzeWithMediaInfo(fileOrBlob);
  } catch (err) {
    errors.push(`MediaInfo inspection warning: ${err?.message || err}`);
  }

  let ffProbeData = null;
  if (ffmpegClient?.isLoaded && !ffmpegClient.isBusy) {
    const extMatch = /(\.[a-zA-Z0-9]{1,8})$/.exec(String(displayFileName || fileOrBlob?.name || ''));
    const probeRes = await ffmpegClient.probeStreams(fileOrBlob, extMatch ? extMatch[1] : '');
    if (probeRes?.json) {
      ffProbeData = probeRes.json;
    } else if (probeRes?.logs?.length) {
      ffProbeData = parseFFmpegLogsFallback(probeRes.logs);
    }
  }

  const generalTrack = tracks.find((t) => t['@type'] === 'General') || {};
  const miVideos = tracks.filter((t) => t['@type'] === 'Video');
  const miAudios = tracks.filter((t) => t['@type'] === 'Audio');
  const miSubtitles = tracks.filter((t) => t['@type'] === 'Text');

  const ffStreams = ffProbeData?.streams || [];
  const ffVideos = ffStreams.filter((s) => s.codec_type === 'video');
  const ffAudios = ffStreams.filter((s) => s.codec_type === 'audio');
  const ffSubtitles = ffStreams.filter((s) => s.codec_type === 'subtitle');
  const ffFormat = ffProbeData?.format || {};

  // Container format
  const rawContainer = generalTrack.Format || ffFormat.format_name || null;
  const container = makeField(
    rawContainer ? String(rawContainer) : null,
    'unknown'
  );

  // Duration
  const rawDuration =
    parseNumberOrNull(generalTrack.Duration) ??
    parseNumberOrNull(ffFormat.duration);
  const durationSec = makeField(rawDuration, 'undetermined');

  // Overall bitrate
  const rawOverallBr =
    parseNumberOrNull(generalTrack.OverallBitRate) ??
    parseNumberOrNull(ffFormat.bit_rate);
  const overallBitrateBps = makeField(rawOverallBr, 'undetermined');

  // Build video streams
  const videoCount = Math.max(miVideos.length, ffVideos.length);
  const videoStreams = [];
  for (let i = 0; i < videoCount; i += 1) {
    const mv = miVideos[i] || {};
    const fv = ffVideos[i] || {};

    const codecName = fv.codec_name || mv.Format || null;
    const codecDisplay = mv.Format && fv.codec_name && mv.Format.toLowerCase() !== fv.codec_name.toLowerCase()
      ? `${mv.Format} (${fv.codec_name})`
      : (mv.Format || fv.codec_name || null);

    const widthVal = parseNumberOrNull(fv.width) ?? parseNumberOrNull(mv.Width);
    const heightVal = parseNumberOrNull(fv.height) ?? parseNumberOrNull(mv.Height);

    const sarVal =
      parseFractionOrFloat(fv.sample_aspect_ratio) ??
      parseNumberOrNull(mv.PixelAspectRatio) ??
      1;
    const darStr = fv.display_aspect_ratio || mv.DisplayAspectRatio_String || null;
    const darVal = parseFractionOrFloat(fv.display_aspect_ratio) ?? parseNumberOrNull(mv.DisplayAspectRatio);

    // Rotation
    let rotVal = parseNumberOrNull(mv.Rotation);
    if (rotVal === null && mv.Rotation === '0') rotVal = 0;
    if (rotVal === null && fv.tags?.rotate !== undefined) {
      rotVal = Number(fv.tags.rotate);
    }
    if (rotVal === null && Array.isArray(fv.side_data_list)) {
      const displayMatrix = fv.side_data_list.find((sd) => typeof sd.rotation === 'number');
      if (displayMatrix) rotVal = Math.abs(displayMatrix.rotation);
    }

    // FPS & VFR/CFR detection
    const avgFps = parseFractionOrFloat(fv.avg_frame_rate) ?? parseNumberOrNull(mv.FrameRate);
    const nominalFps = parseFractionOrFloat(fv.r_frame_rate);
    let fpsModeVal = null;
    if (mv.FrameRate_Mode === 'VFR') fpsModeVal = 'VFR';
    else if (mv.FrameRate_Mode === 'CFR') fpsModeVal = 'CFR';
    else if (avgFps && nominalFps && Math.abs(avgFps - nominalFps) > 0.25) fpsModeVal = 'VFR';
    else if (avgFps) fpsModeVal = 'CFR';

    const vBitrate = parseNumberOrNull(mv.BitRate) ?? parseNumberOrNull(fv.bit_rate);

    let pixFmt = fv.pix_fmt || null;
    if (!pixFmt && mv.ColorSpace && mv.ChromaSubsampling) {
      pixFmt = `${mv.ColorSpace.toLowerCase()}${mv.ChromaSubsampling.replace(/:/g, '')}${mv.BitDepth && Number(mv.BitDepth) > 8 ? `p${mv.BitDepth}le` : 'p'}`;
    }

    videoStreams.push({
      index: i,
      ffStreamIndex: fv.index ?? i,
      codec: makeField(codecDisplay, 'unknown'),
      codecRaw: makeField(codecName, 'unknown'),
      profile: makeField(fv.profile || mv.Format_Profile || null, 'missing'),
      width: makeField(widthVal, 'undetermined'),
      height: makeField(heightVal, 'undetermined'),
      sampleAspectRatio: makeField(sarVal, 'undetermined'),
      displayAspectRatio: makeField(darStr || (darVal ? darVal.toFixed(3) : null), 'undetermined'),
      displayAspectRatioValue: darVal,
      rotationDeg: { value: Number.isFinite(rotVal) ? rotVal : 0, status: rotVal !== null ? 'known' : 'missing' },
      fps: makeField(avgFps, 'undetermined'),
      fpsMode: makeField(fpsModeVal, 'undetermined'),
      bitrateBps: makeField(vBitrate, 'undetermined'),
      pixelFormat: makeField(pixFmt, 'undetermined'),
      bitDepth: makeField(parseNumberOrNull(mv.BitDepth) ?? parseNumberOrNull(fv.bits_per_raw_sample), 'missing'),
    });
  }

  // Build audio streams
  const audioCount = Math.max(miAudios.length, ffAudios.length);
  const audioStreams = [];
  for (let i = 0; i < audioCount; i += 1) {
    const ma = miAudios[i] || {};
    const fa = ffAudios[i] || {};
    const codecName = fa.codec_name || ma.Format || null;
    const codecDisplay = ma.Format && fa.codec_name && ma.Format.toLowerCase() !== fa.codec_name.toLowerCase()
      ? `${ma.Format} (${fa.codec_name})`
      : (ma.Format || fa.codec_name || null);

    audioStreams.push({
      index: i,
      ffStreamIndex: fa.index ?? i,
      codec: makeField(codecDisplay, 'unknown'),
      codecRaw: makeField(codecName, 'unknown'),
      bitrateBps: makeField(parseNumberOrNull(ma.BitRate) ?? parseNumberOrNull(fa.bit_rate), 'undetermined'),
      sampleRateHz: makeField(parseNumberOrNull(fa.sample_rate) ?? parseNumberOrNull(ma.SamplingRate), 'undetermined'),
      channels: makeField(parseNumberOrNull(fa.channels) ?? parseNumberOrNull(ma.Channels), 'undetermined'),
      channelLayout: makeField(fa.channel_layout || ma.ChannelLayout || null, 'missing'),
      language: makeField(fa.tags?.language || ma.Language || null, 'missing'),
    });
  }

  // Build subtitle streams
  const subCount = Math.max(miSubtitles.length, ffSubtitles.length);
  const subtitleStreams = [];
  for (let i = 0; i < subCount; i += 1) {
    const ms = miSubtitles[i] || {};
    const fs = ffSubtitles[i] || {};
    subtitleStreams.push({
      index: i,
      ffStreamIndex: fs.index ?? i,
      codec: makeField(fs.codec_name || ms.Format || null, 'unknown'),
      language: makeField(fs.tags?.language || ms.Language || null, 'missing'),
      title: makeField(fs.tags?.title || ms.Title || null, 'missing'),
    });
  }

  const totalStreams =
    ffStreams.length > 0
      ? ffStreams.length
      : videoStreams.length + audioStreams.length + subtitleStreams.length;

  return {
    fileName: displayFileName || fileOrBlob?.name || 'output',
    fileSize: fileOrBlob?.size ?? 0,
    container,
    durationSec,
    overallBitrateBps,
    streamCount: totalStreams > 0 ? makeField(totalStreams) : makeField(null, 'undetermined'),
    videoStreams,
    audioStreams,
    subtitleStreams,
    inspectionSource: ffProbeData ? 'mediainfo+ffmpeg' : 'mediainfo',
    warnings: errors,
  };
}
