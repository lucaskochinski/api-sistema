'use strict';

const { Queue } = require('bullmq');
const db = require('../Models');
const { createBullMqConnection } = require('../Workers/redisConnection');
const {
  DAILY_SYNC_QUEUE_NAME,
  DAILY_SYNC_JOB_NAME,
} = require('../Workers/queues/constants');

/** Reaproveitar conexão publisher na API para não multiplicar clientes Redis. */
let redisSingleton;
/** @returns {ReturnType<typeof createBullMqConnection>} */
function redisConn() {
  if (!redisSingleton) redisSingleton = createBullMqConnection();
  return redisSingleton;
}

function getDailySyncQueue() {
  return new Queue(DAILY_SYNC_QUEUE_NAME, {
    connection: redisConn(),
  });
}

/** @param {unknown} raw */
function extractDailySyncHHMM(raw) {
  if (raw == null) return '02:30';
  if (typeof raw === 'string') return raw.trim();
  if (typeof raw === 'object' && raw.time != null)
    return String(raw.time).trim();
  return '02:30';
}

function parseHHMMToCronUtc(hhmm) {
  const s = extractDailySyncHHMM(hhmm);
  const hit = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(s);
  if (!hit) {
    const err = new Error('invalid_DAILY_SYNC_TIME_expected_HH_MM_UTC');
    err.statusCode = 400;
    throw err;
  }
  const hh = Number(hit[1]);
  const mm = Number(hit[2]);
  /** Cron UTC: minuto hora dia mês dow */
  return `${mm} ${hh} * * *`;
}

async function removeExistingRepeatables(queue) {
  const rep = await queue.getRepeatableJobs();
  await Promise.all(
    rep
      .filter((j) => j.name === DAILY_SYNC_JOB_NAME)
      .map((j) => queue.removeRepeatableByKey(j.key)),
  );
}

/** Lê DB, remove repeatable antigo e agenda novo `DAILY_SYNC_TIME` em UTC */
async function rescheduleDailyMetaInsightsSync() {
  const queue = getDailySyncQueue();

  await removeExistingRepeatables(queue);

  let row = null;
  try {
    row = await db.SystemSetting.findOne({
      where: { key: 'DAILY_SYNC_TIME' },
    });
  } catch (_e) {
    console.warn('[daily_sync.scheduler] DB indisponível para settings');
    return { skipped: true };
  }

  const pattern = parseHHMMToCronUtc(row?.value);

  await queue.add(
    DAILY_SYNC_JOB_NAME,
    { queuedAtUtc: new Date().toISOString() },
    {
      repeat: { pattern, tz: 'Etc/UTC' },
      removeOnComplete: Number(process.env.DAILY_SYNC_KEEP_COMPLETED_JOBS || 24),
      removeOnFail: false,
    },
  );

  return { scheduled: true, patternUtc: pattern };
}

async function ensureDailySyncScheduleOnBoot() {
  try {
    return await rescheduleDailyMetaInsightsSync();
  } catch (e) {
    console.warn('[daily_sync.scheduler] falha ao agendar (Redis/API):', e.message);
    return { error: e.message };
  }
}

module.exports = {
  getDailySyncQueue,
  rescheduleDailyMetaInsightsSync,
  ensureDailySyncScheduleOnBoot,
  parseHHMMToCronUtc,
  extractDailySyncHHMM,
};
