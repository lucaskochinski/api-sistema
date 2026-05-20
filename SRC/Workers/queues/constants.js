'use strict';

/** Fila principal: transcrição + insights */
const VIDEO_TRANSCRIPTION_QUEUE = 'video-transcription-queue';

/** Dead-letter: payloads após esgotamento de retries (reprocessamento manual / observabilidade) */
const VIDEO_TRANSCRIPTION_DLQ = 'video-transcription-dlq';

/** Sincronização diária (Meta insights → `ad_performance_daily`) configurável pelo admin */
const DAILY_SYNC_QUEUE_NAME = 'daily-meta-insights-queue';
/** Nome estável BullMQ repeatable */
const DAILY_SYNC_JOB_NAME = 'daily_meta_insights_rollup';

module.exports = {
  VIDEO_TRANSCRIPTION_QUEUE,
  VIDEO_TRANSCRIPTION_DLQ,
  DAILY_SYNC_QUEUE_NAME,
  DAILY_SYNC_JOB_NAME,
};
