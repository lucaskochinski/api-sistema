'use strict';

const { Worker, UnrecoverableError } = require('bullmq');
const db = require('../Models');
const { createBullMqConnection } = require('./redisConnection');
const { VIDEO_TRANSCRIPTION_QUEUE } = require('./queues/constants');
const processor = require('./processors/videoTranscription.processor');
const { pushDlqJob } = require('./queues/videoTranscription.queue');
const { loadIntegrationConfig } = require('../Services/integration_config.service');

const concurrency = Number(process.env.WORKER_VIDEO_CONCURRENCY || 3);
const redisConnection = createBullMqConnection();

const worker = new Worker(VIDEO_TRANSCRIPTION_QUEUE, processor, {
  concurrency,
  connection: redisConnection,
});

worker.on('completed', (job, result) => {
  console.info('[worker:video] completed job', job.id, result?.transcriptChars ?? '');
});

worker.on('failed', async (job, err) => {
  if (!job) return;

  const maxAttempts =
    typeof job.opts.attempts === 'number'
      ? job.opts.attempts
      : Number(process.env.VIDEO_JOB_ATTEMPTS || 5);
  const isFinal =
    err instanceof UnrecoverableError || job.attemptsMade >= maxAttempts;

  console.error('[worker:video] job failed', {
    jobId: job.id,
    attemptsMade: job.attemptsMade,
    maxAttempts,
    unrecoverable: err instanceof UnrecoverableError,
    message: err?.message,
  });

  if (!isFinal) return;

  try {
    const mediaId = job.data?.mediaId;
    if (mediaId) {
      const asset = await db.MediaAsset.findByPk(mediaId);
      if (asset) {
        await asset.update({
          processingStatus: 'failed',
          ingestMetadata: {
            ...asset.ingestMetadata,
            lastPipelineFailureReason: err?.message || String(err),
            lastPipelineFailureAt: new Date().toISOString(),
            deadLetterEligible: true,
          },
        });
      }
    }
  } catch (metaErr) {
    console.error('[worker:video]could not annotate media failure metadata', metaErr.message);
  }

  await pushDlqJob({
    reason: err?.message || String(err),
    unrecoverable: err instanceof UnrecoverableError,
    originalQueue: VIDEO_TRANSCRIPTION_QUEUE,
    attemptsMade: job.attemptsMade,
    attemptsConfigured: maxAttempts,
    payload: job.data,
  });
});

async function shutdown() {
  await worker.close();
  await redisConnection.quit();
  await db.sequelize.close().catch(() => {});
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

(async () => {
  await db.sequelize.authenticate();
  await loadIntegrationConfig().catch((e) => {
    console.warn('[worker:video] integration config load failed — using env only', e.message);
  });
  console.info(`[worker:video] running queue="${VIDEO_TRANSCRIPTION_QUEUE}" concurrency=${concurrency}`);
})().catch((e) => {
  console.error('[worker:video] bootstrap failed', e);
  process.exit(1);
});
