'use strict';

const { enqueueVideoAnalyzeJob } = require('../../Workers/queues/videoTranscription.queue');
const db = require('../../Models');

const UUID_V4ISH =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function assertUuid(value, field) {
  if (!value || !UUID_V4ISH.test(String(value))) {
    const err = new Error(`invalid_${field}`);
    err.statusCode = 400;
    throw err;
  }
}

function hasCachedTranscript(media) {
  const meta = media?.ingestMetadata && typeof media.ingestMetadata === 'object'
    ? media.ingestMetadata
    : {};
  return Boolean(meta.transcriptFull && String(meta.transcriptFull).trim());
}

/**
 * Enfileira job BullMQ (não bloqueia na transcrição). Atualiza `media_assets.processing_status`.
 */
async function queueVideoAnalysis({
  mediaId,
  organizationId,
  adId,
  actingUserProfile = null,
  force = false,
}) {
  assertUuid(mediaId, 'media_id');
  assertUuid(organizationId, 'organization_id');
  assertUuid(adId, 'ad_id');

  const media = await db.MediaAsset.findByPk(mediaId);
  if (!media) {
    const err = new Error('media_not_found');
    err.statusCode = 404;
    throw err;
  }

  const claim = await db.OrganizationMediaClaim.findOne({
    where: { organizationId, mediaId },
  });
  if (!claim) {
    const err = new Error('organization_media_claim_missing');
    err.statusCode = 403;
    throw err;
  }

  const ad = await db.Ad.findOne({ where: { id: adId, organizationId } });
  if (!ad) {
    const err = new Error('ad_not_found_for_organization');
    err.statusCode = 404;
    throw err;
  }

  const driveFileId = media.googleDriveFileId ? String(media.googleDriveFileId).trim() : '';
  const metaVid = media.metaVideoId ? String(media.metaVideoId).trim() : '';
  if (!driveFileId && !metaVid) {
    const err = new Error('media_missing_video_source');
    err.statusCode = 422;
    throw err;
  }

  if (!force) {
    const existingAnalysis = await db.CreativeAnalysis.findOne({
      where: { organizationId, adId },
      attributes: ['id'],
    });
    if (existingAnalysis) {
      const err = new Error('creative_analysis_already_exists');
      err.statusCode = 409;
      throw err;
    }
  }

  const actingUserSnapshot =
    actingUserProfile && (actingUserProfile.email || actingUserProfile.roles?.length)
      ? {
          email: actingUserProfile.email,
          roles: Array.isArray(actingUserProfile.roles) ? actingUserProfile.roles : [],
        }
      : null;

  const skipTranscription = hasCachedTranscript(media);

  const job = await enqueueVideoAnalyzeJob({
    mediaId,
    organizationId,
    adId,
    requestedAt: new Date().toISOString(),
    sourcePipeline: force ? 'manual_reanalyze' : 'manual_analyze',
    actingUserSnapshot,
    skipTranscription,
    forceReanalyze: Boolean(force),
  });

  await media.update({
    processingStatus: skipTranscription ? 'awaiting_ai' : 'queued_video',
    ingestMetadata: {
      ...(media.ingestMetadata || {}),
      analyzeRequestedAt: new Date().toISOString(),
      lastQueuedJobId: job.id,
      lastAnalyzeTrigger: force ? 'reanalyze' : 'manual',
    },
  });

  return {
    jobId: job.id,
    skipTranscription,
    processingStatus: skipTranscription ? 'awaiting_ai' : 'queued_video',
  };
}

module.exports = {
  queueVideoAnalysis,
  hasCachedTranscript,
};
