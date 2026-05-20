'use strict';

const mediaService = require('./media.service');

async function analyzeMediaAsync(req, res, next) {
  try {
    const { mediaId } = req.params;
    const { organizationId, adId } = req.body || {};
    const { jobId } = await mediaService.queueVideoAnalysis({
      mediaId,
      organizationId,
      adId,
      actingUserProfile: {
        email: req.user.email,
        roles: Array.isArray(req.user.roles) ? req.user.roles : [],
      },
    });
    res.status(202).json({
      status: 'accepted',
      message: 'video_transcription_job_queued',
      jobId,
      mediaId,
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  analyzeMediaAsync,
};
