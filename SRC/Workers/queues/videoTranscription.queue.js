'use strict';

const { Queue } = require('bullmq');
const { createBullMqConnection } = require('../redisConnection');
const {
  VIDEO_TRANSCRIPTION_QUEUE,
  VIDEO_TRANSCRIPTION_DLQ,
} = require('./constants');

/** Conexões dedicadas (evita contenção subscriber/publisher dentro do mesmo client). */

let producerConnectionMain;
let producerConnectionDlq;
let videoQueueSingleton;
let dlqQueueSingleton;

function getProducerConnectionMain() {
  if (!producerConnectionMain) producerConnectionMain = createBullMqConnection();
  return producerConnectionMain;
}

function getProducerDlqConnection() {
  if (!producerConnectionDlq) producerConnectionDlq = createBullMqConnection();
  return producerConnectionDlq;
}

function getVideoTranscriptionQueue() {
  if (!videoQueueSingleton) {
    videoQueueSingleton = new Queue(VIDEO_TRANSCRIPTION_QUEUE, {
      connection: getProducerConnectionMain(),
      defaultJobOptions: {
        attempts: Number(process.env.VIDEO_JOB_ATTEMPTS || 5),
        backoff: {
          type: 'exponential',
          delay: Number(process.env.VIDEO_JOB_BACKOFF_MS || 3000),
        },
        removeOnComplete: Number(process.env.VIDEO_JOB_KEEP_COMPLETED || 200),
        removeOnFail: false,
      },
    });
  }
  return videoQueueSingleton;
}

function getDlqQueue() {
  if (!dlqQueueSingleton) {
    dlqQueueSingleton = new Queue(VIDEO_TRANSCRIPTION_DLQ, {
      connection: getProducerDlqConnection(),
      defaultJobOptions: {
        removeOnComplete: false,
        attempts: 1,
      },
    });
  }
  return dlqQueueSingleton;
}

/**
 * Enfileira análise assíncrona (Deepgram → Gemini → creative_analyses).
 * @returns {Promise<{ id: string, name: string }>}
 */
async function enqueueVideoAnalyzeJob(payload) {
  const queue = getVideoTranscriptionQueue();
  const job = await queue.add('deepgram_transcribe_and_insights', payload);
  return { id: String(job.id), name: job.name };
}

async function pushDlqJob(deadLetterPayload) {
  const dlq = getDlqQueue();
  await dlq.add(
    'transcription.failed',
    {
      deadLetteredAt: new Date().toISOString(),
      ...deadLetterPayload,
    },
    { removeOnFail: false },
  );
}

module.exports = {
  getVideoTranscriptionQueue,
  getDlqQueue,
  enqueueVideoAnalyzeJob,
  pushDlqJob,
};
