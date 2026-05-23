'use strict';

const { UnrecoverableError } = require('bullmq');
const {
  runSyncVideoCreativeAnalysis,
  SyncCreativeAnalysisError,
} = require('../../Services/sync_creative_analysis.service');

/** Processamento assíncrono: arquivo (Google Drive ou vídeo Meta) → transcrição → Gemini → DB. */

module.exports = async function videoTranscriptionProcessor(job) {
  const { mediaId, organizationId, adId } = job.data;

  try {
    return await runSyncVideoCreativeAnalysis({
      organizationId,
      mediaId,
      adId,
      actingUserProfile: job.data.actingUserSnapshot || null,
      skipTranscription: Boolean(job.data.skipTranscription),
      jobId: job.id,
    });
  } catch (err) {
    if (err instanceof SyncCreativeAnalysisError && err.unrecoverable) {
      throw new UnrecoverableError(err.message);
    }
    throw err;
  }
};
