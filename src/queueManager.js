import { CONTAINERS } from './codecs.js';
import { buildFFmpegCommand } from './commandBuilder.js';
import { verifyOutput } from './outputVerifier.js';

function sanitizeDownloadFilename(originalName, newExt) {
  const base = String(originalName || 'video')
    .replace(/\.[^/.]+$/, '')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .trim() || 'video';
  return `${base}_converted${newExt}`;
}

function getInputExtension(fileName) {
  const match = /(\.[a-zA-Z0-9]{1,8})$/.exec(String(fileName || ''));
  return match ? match[1].toLowerCase() : '.mp4';
}

export class QueueManager {
  #jobs = [];
  #running = false;
  #cancelRequested = false;
  #activeJobId = null;
  #ffmpegClient;
  #onChange;

  constructor(ffmpegClient, onChange) {
    this.#ffmpegClient = ffmpegClient;
    this.#onChange = onChange;
  }

  get jobs() {
    return this.#jobs;
  }

  get isRunning() {
    return this.#running;
  }

  get activeJobId() {
    return this.#activeJobId;
  }

  getSummary() {
    const total = this.#jobs.length;
    const pending = this.#jobs.filter((j) => j.status === 'pending').length;
    const completed = this.#jobs.filter((j) => j.status === 'completed').length;
    const failed = this.#jobs.filter((j) => j.status === 'failed').length;
    const cancelled = this.#jobs.filter((j) => j.status === 'cancelled').length;
    const processing = this.#jobs.filter((j) => j.status === 'processing').length;

    let progressSum = 0;
    for (const j of this.#jobs) {
      if (j.status === 'completed') progressSum += 1;
      else if (j.status === 'processing') progressSum += j.progress || 0;
    }
    const actionable = this.#jobs.filter((j) => j.status !== 'cancelled').length;
    const overallProgress = actionable > 0 ? progressSum / actionable : 0;

    return {
      total,
      pending,
      completed,
      failed,
      cancelled,
      processing,
      overallProgress,
    };
  }

  #notify() {
    this.#onChange?.(this.#jobs, this.getSummary());
  }

  addJob({ file, inspection, settings }) {
    const containerSpec = CONTAINERS.find((c) => c.id === settings.container);
    const id = `job_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const snapshotSettings = structuredClone(settings);

    const job = {
      id,
      file,
      fileName: file.name,
      fileSize: file.size,
      inspection,
      settings: snapshotSettings,
      outputFileName: sanitizeDownloadFilename(file.name, containerSpec?.ext || '.mp4'),
      status: 'pending', // 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled'
      phase: 'Waiting in queue',
      progress: 0,
      outputUrl: null,
      outputSize: null,
      verification: null,
      commandArgs: null,
      error: null,
      createdAt: Date.now(),
    };

    this.#jobs.push(job);
    this.#notify();
    return job;
  }

  updatePendingJob(jobId, newSettings) {
    const job = this.#jobs.find((j) => j.id === jobId);
    if (!job || job.status !== 'pending') {
      throw new Error('Only pending jobs can be modified.');
    }
    const containerSpec = CONTAINERS.find((c) => c.id === newSettings.container);
    job.settings = structuredClone(newSettings);
    job.outputFileName = sanitizeDownloadFilename(job.fileName, containerSpec?.ext || '.mp4');
    job.error = null;
    this.#notify();
    return job;
  }

  removeJob(jobId) {
    const idx = this.#jobs.findIndex((j) => j.id === jobId);
    if (idx === -1) return false;
    const job = this.#jobs[idx];
    if (job.status === 'processing') {
      throw new Error('Cannot remove an actively running job. Cancel it first.');
    }
    if (job.outputUrl) {
      URL.revokeObjectURL(job.outputUrl);
      job.outputUrl = null;
    }
    this.#jobs.splice(idx, 1);
    this.#notify();
    return true;
  }

  movePendingJob(jobId, direction) {
    const idx = this.#jobs.findIndex((j) => j.id === jobId);
    if (idx === -1) return false;
    const job = this.#jobs[idx];
    if (job.status !== 'pending') return false;

    const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (targetIdx < 0 || targetIdx >= this.#jobs.length) return false;
    if (this.#jobs[targetIdx].status !== 'pending') return false;

    const [moved] = this.#jobs.splice(idx, 1);
    this.#jobs.splice(targetIdx, 0, moved);
    this.#notify();
    return true;
  }

  retryJob(jobId) {
    const job = this.#jobs.find((j) => j.id === jobId);
    if (!job || (job.status !== 'failed' && job.status !== 'cancelled')) return false;
    if (job.outputUrl) {
      URL.revokeObjectURL(job.outputUrl);
      job.outputUrl = null;
    }
    job.status = 'pending';
    job.phase = 'Waiting in queue';
    job.progress = 0;
    job.outputSize = null;
    job.verification = null;
    job.error = null;
    this.#notify();
    return true;
  }

  clearFinished() {
    this.#jobs = this.#jobs.filter((job) => {
      if (job.status === 'completed' || job.status === 'cancelled') {
        if (job.outputUrl) {
          URL.revokeObjectURL(job.outputUrl);
          job.outputUrl = null;
        }
        return false;
      }
      return true;
    });
    this.#notify();
  }

  async startQueue() {
    if (this.#running) return;
    this.#running = true;
    this.#cancelRequested = false;
    this.#notify();

    try {
      while (!this.#cancelRequested) {
        const nextJob = this.#jobs.find((j) => j.status === 'pending');
        if (!nextJob) break;

        this.#activeJobId = nextJob.id;
        nextJob.status = 'processing';
        nextJob.phase = 'Initializing FFmpeg worker';
        nextJob.progress = 0;
        nextJob.error = null;
        nextJob.verification = null;
        this.#notify();

        try {
          if (!this.#ffmpegClient.isLoaded) {
            await this.#ffmpegClient.init();
          }

          const containerSpec = CONTAINERS.find((c) => c.id === nextJob.settings.container);
          const inputExt = getInputExtension(nextJob.fileName);
          const outputExt = containerSpec?.ext || '.mp4';

          nextJob.phase = 'Encoding video';
          this.#notify();

          const { blob, args } = await this.#ffmpegClient.transcode({
            jobId: nextJob.id,
            file: nextJob.file,
            inputExt,
            outputExt,
            outputMime: containerSpec?.mime || 'video/mp4',
            buildArgs: (inputVirtualPath, outputVirtualPath) => {
              const built = buildFFmpegCommand({
                inputVirtualPath,
                outputVirtualPath,
                settings: nextJob.settings,
                inspection: nextJob.inspection,
              });
              nextJob.commandArgs = built.args;
              return built.args;
            },
            onProgress: ({ progress }) => {
              if (nextJob.status === 'processing') {
                nextJob.progress = progress;
                this.#notify();
              }
            },
          });

          if (this.#cancelRequested) {
            nextJob.status = 'cancelled';
            nextJob.phase = 'Cancelled';
            this.#notify();
            break;
          }

          nextJob.phase = 'Verifying output integrity';
          nextJob.progress = 1;
          this.#notify();

          const verification = await verifyOutput({
            outputBlob: blob,
            outputFileName: nextJob.outputFileName,
            settings: nextJob.settings,
            inputInspection: nextJob.inspection,
            ffmpegClient: this.#ffmpegClient,
          });

          nextJob.verification = verification;
          if (!verification.passed) {
            nextJob.status = 'failed';
            nextJob.phase = 'Output verification failed';
            nextJob.error = verification.failures.join(' ');
          } else {
            nextJob.outputUrl = URL.createObjectURL(blob);
            nextJob.outputSize = blob.size;
            nextJob.status = 'completed';
            nextJob.phase =
              verification.status === 'warnings'
                ? 'Completed with verification notes'
                : 'Completed and verified';
          }
        } catch (err) {
          if (this.#cancelRequested || err?.name === 'AbortError') {
            nextJob.status = 'cancelled';
            nextJob.phase = 'Cancelled by user';
            nextJob.error = null;
          } else {
            nextJob.status = 'failed';
            nextJob.phase = 'Conversion failed';
            nextJob.error = err?.message || String(err);
          }
        } finally {
          this.#activeJobId = null;
          this.#notify();
        }
      }
    } finally {
      this.#running = false;
      this.#activeJobId = null;
      this.#notify();
    }
  }

  async cancelActiveJob() {
    if (!this.#running || !this.#activeJobId) return;
    this.#cancelRequested = true;
    const activeJob = this.#jobs.find((j) => j.id === this.#activeJobId);
    if (activeJob) {
      activeJob.phase = 'Terminating worker...';
      this.#notify();
    }
    await this.#ffmpegClient.cancelAndReset();
    if (activeJob && activeJob.status === 'processing') {
      activeJob.status = 'cancelled';
      activeJob.phase = 'Cancelled by user';
      activeJob.progress = 0;
    }
    this.#running = false;
    this.#activeJobId = null;
    this.#notify();

    // Pre-warm FFmpeg engine in background so remaining pending jobs can run cleanly when started
    this.#ffmpegClient.init().catch(() => {});
  }
}
