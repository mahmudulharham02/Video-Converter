import {
  AUDIO_ENCODERS,
  CONTAINERS,
  VIDEO_ENCODERS,
  normalizeCodecToken,
  solveOutputDimensions,
} from './codecs.js';
import { formatBitrate, formatDuration, formatField, inspectMedia } from './mediaInspector.js';

function containerMatches(requestedId, actualContainerRaw) {
  const actual = String(actualContainerRaw || '').toLowerCase();
  if (!actual) return null; // undetermined
  switch (requestedId) {
    case 'mp4':
      return actual.includes('mpeg-4') || actual.includes('mp4') || actual.includes('isom');
    case 'mov':
      return actual.includes('quicktime') || actual.includes('mov') || actual.includes('mpeg-4');
    case 'mkv':
      return actual.includes('matroska') || actual.includes('mkv');
    case 'webm':
      return actual.includes('webm') || actual.includes('matroska');
    case 'avi':
      return actual.includes('avi');
    case 'mpeg':
      return actual.includes('mpeg');
    case 'ts':
      return actual.includes('mpeg-ts') || actual.includes('mpegts') || actual.includes('bdav');
    case 'wmv':
      return actual.includes('windows media') || actual.includes('asf') || actual.includes('wmv');
    default:
      return true;
  }
}

export async function verifyOutput({
  outputBlob,
  outputFileName,
  settings,
  inputInspection,
  ffmpegClient,
}) {
  const checks = [];
  const warnings = [];
  const failures = [];

  if (!outputBlob || outputBlob.size === 0) {
    failures.push('Output file is empty (0 bytes).');
    return {
      passed: false,
      status: 'failed',
      checks,
      warnings,
      failures,
      inspection: null,
    };
  }

  const inspection = await inspectMedia(outputBlob, outputFileName, ffmpegClient);
  const containerSpec = CONTAINERS.find((c) => c.id === settings.container);
  const vEnc = VIDEO_ENCODERS[settings.videoCodec];

  // 1. Container check
  const actualContainer = inspection.container?.value;
  const contMatch = containerMatches(settings.container, actualContainer);
  if (contMatch === false) {
    failures.push(
      `Container mismatch: expected ${containerSpec?.label || settings.container}, got "${actualContainer}".`
    );
  } else if (contMatch === null) {
    warnings.push('Output container format could not be reliably determined.');
  } else {
    checks.push(`Container: ${actualContainer}`);
  }

  // 2. Video stream & codec check
  const outV = inspection.videoStreams?.[0];
  if (!outV) {
    failures.push('Output contains no readable video stream.');
  } else {
    const actualVCodec = normalizeCodecToken(outV.codecRaw?.value || outV.codec?.value);
    if (actualVCodec && vEnc?.family && actualVCodec !== vEnc.family) {
      failures.push(
        `Video codec mismatch: expected ${vEnc.family}, got ${outV.codec?.value}.`
      );
    } else {
      checks.push(`Video codec: ${formatField(outV.codec)}`);
    }

    // 3. Resolution check
    const srcV =
      inputInspection.videoStreams?.[settings.videoStreamIndex] ||
      inputInspection.videoStreams?.[0];
    const expectedDims = solveOutputDimensions({
      videoStream: srcV,
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

    const actW = outV.width?.value;
    const actH = outV.height?.value;
    if (!actW || !actH) {
      warnings.push('Output video dimensions could not be verified.');
    } else if (expectedDims.width && expectedDims.height) {
      if (settings.scalingMode === 'preserve') {
        if (actW > expectedDims.width + 2 || actH > expectedDims.height + 2) {
          warnings.push(
            `Output resolution (${actW}x${actH}) differs from bounding target (${expectedDims.width}x${expectedDims.height}).`
          );
        } else {
          checks.push(`Resolution: ${actW}×${actH}`);
        }
      } else if (Math.abs(actW - expectedDims.width) > 2 || Math.abs(actH - expectedDims.height) > 2) {
        failures.push(
          `Resolution mismatch: requested ${expectedDims.width}×${expectedDims.height}, got ${actW}×${actH}.`
        );
      } else {
        checks.push(`Resolution: ${actW}×${actH}`);
      }
    }

    // 4. FPS check
    const actFps = outV.fps?.value;
    if (settings.fpsMode && settings.fpsMode !== 'original') {
      const reqFps =
        settings.fpsMode === 'custom' ? Number(settings.customFps) : Number(settings.fpsMode);
      if (actFps && Number.isFinite(reqFps) && Math.abs(actFps - reqFps) > 0.75) {
        warnings.push(
          `Requested ${reqFps} fps, measured ${actFps.toFixed(3)} fps.`
        );
      } else if (actFps) {
        checks.push(`Frame rate: ${actFps.toFixed(2)} fps`);
      }
    } else if (actFps) {
      checks.push(`Frame rate: ${actFps.toFixed(2)} fps (${formatField(outV.fpsMode)})`);
    }

    if (outV.bitrateBps?.value) {
      checks.push(`Video bitrate: ${formatBitrate(outV.bitrateBps.value)}`);
    }
  }

  // 5. Audio check
  const srcHadAudio = (inputInspection.audioStreams?.length || 0) > 0;
  const outA = inspection.audioStreams?.[0];
  if (settings.audioMode === 'none') {
    if (outA) {
      failures.push('Audio was requested to be removed, but output still contains an audio stream.');
    } else {
      checks.push('Audio: Removed as requested');
    }
  } else if (srcHadAudio) {
    if (!outA) {
      failures.push('Expected an audio stream in output, but none was detected.');
    } else {
      if (settings.audioMode === 'encode') {
        const aEnc = AUDIO_ENCODERS[settings.audioCodec];
        const actACodec = normalizeCodecToken(outA.codecRaw?.value || outA.codec?.value);
        if (aEnc && actACodec && actACodec !== aEnc.family) {
          failures.push(
            `Audio codec mismatch: expected ${aEnc.family}, got ${outA.codec?.value}.`
          );
        } else {
          checks.push(
            `Audio: ${formatField(outA.codec)}${outA.bitrateBps?.value ? ` @ ${formatBitrate(outA.bitrateBps.value)}` : ''}`
          );
        }
      } else {
        checks.push(`Audio preserved: ${formatField(outA.codec)}`);
      }
    }
  }

  // 6. Duration sanity
  const inDur = inputInspection.durationSec?.value;
  const outDur = inspection.durationSec?.value;
  if (outDur !== null && outDur !== undefined) {
    if (outDur <= 0) {
      failures.push('Output duration is zero.');
    } else if (inDur && Math.abs(outDur - inDur) > Math.max(2.0, inDur * 0.08)) {
      warnings.push(
        `Duration differs noticeably from input (${formatDuration(outDur)} vs ${formatDuration(inDur)}).`
      );
    } else {
      checks.push(`Duration: ${formatDuration(outDur)}`);
    }
  } else {
    warnings.push('Output duration could not be verified.');
  }

  if (inspection.streamCount?.value) {
    checks.push(`Streams: ${inspection.streamCount.value}`);
  }

  const passed = failures.length === 0;
  const status = !passed ? 'failed' : warnings.length > 0 ? 'warnings' : 'verified';

  return {
    passed,
    status,
    checks,
    warnings,
    failures,
    inspection,
  };
}
