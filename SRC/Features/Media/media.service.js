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

/**
 * Enfileira job BullMQ (não bloqueia na transcrição). Atualiza `media_assets.processing_status`.
 */
async function queueVideoAnalysis({
  mediaId,
  organizationId,
  adId,
  actingUserProfile = null,
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

  if (!media.googleDriveFileId) {
    const err = new Error('media_requires_google_drive_file_id');
    err.statusCode = 422;
    throw err;
  }

  const actingUserSnapshot =
    actingUserProfile && (actingUserProfile.email || actingUserProfile.roles?.length)
      ? {
          email: actingUserProfile.email,
          roles: Array.isArray(actingUserProfile.roles) ? actingUserProfile.roles : [],
        }
      : null;

  const job = await enqueueVideoAnalyzeJob({
    mediaId,
    organizationId,
    adId,
    requestedAt: new Date().toISOString(),
    actingUserSnapshot,
  });

  await media.update({
    processingStatus: 'queued_video',
    ingestMetadata: {
      ...media.ingestMetadata,
      analyzeRequestedAt: new Date().toISOString(),
      lastQueuedJobId: job.id,
    },
  });

  return { jobId: job.id };
}

module.exports = {
  queueVideoAnalysis,
};
