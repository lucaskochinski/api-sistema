'use strict';

const { Worker } = require('bullmq');
const db = require('../Models');
const { createBullMqConnection } = require('./redisConnection');
const { DAILY_SYNC_QUEUE_NAME } = require('./queues/constants');
const dailySyncProcessor = require('./processors/dailySync.processor');

const redisConnection = createBullMqConnection();
const concurrency = Number(process.env.DAILY_SYNC_WORKER_CONCURRENCY || 1);

const worker = new Worker(DAILY_SYNC_QUEUE_NAME, dailySyncProcessor, {
  connection: redisConnection,
  concurrency,
});

worker.on('completed', (job, result) => {
  console.info('[worker:daily_sync] completed', job.id, result);
});

worker.on('failed', (job, err) => {
  console.error('[worker:daily_sync] failed', job?.id, err?.message || err);
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
  console.info(
    `[worker:daily_sync] queue="${DAILY_SYNC_QUEUE_NAME}" concurrency=${concurrency}`,
  );
})().catch((e) => {
  console.error('[worker:daily_sync] bootstrap FAILED', e);
  process.exit(1);
});
