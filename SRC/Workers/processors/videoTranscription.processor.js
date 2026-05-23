'use strict';

const { UnrecoverableError } = require('bullmq');
const googledrive = require('../../Features/GoogleDrive/googledrive.service');
const metaVideoSource = require('../../Services/meta_video_source.service');
const mediaTranscription = require('../../Services/media_transcription.service');
const creativeAnalysisService = require('../../Services/creative_analysis.service');
const db = require('../../Models');
const planLimitsService = require('../../Services/plan_limits.service');
const videoGuard = require('../../Services/video_plan_guard.service');
const transcriptionUsage = require('../../Services/transcription_usage.service');

function readCachedTranscript(ingestMetadata) {
  const meta = ingestMetadata && typeof ingestMetadata === 'object' ? ingestMetadata : {};
  const full = meta.transcriptFull || meta.transcript_full;
  if (!full || !String(full).trim()) return null;
  return {
    transcript: String(full).trim(),
    confidence:
      meta.transcriptionConfidence != null
        ? Number(meta.transcriptionConfidence)
        : meta.transcription_confidence != null
          ? Number(meta.transcription_confidence)
          : null,
    durationSeconds:
      meta.transcriptionDeepgramSeconds != null
        ? Number(meta.transcriptionDeepgramSeconds)
        : meta.transcription_gemini_seconds != null
          ? Number(meta.transcription_gemini_seconds)
          : null,
    meta: meta.transcriptionProviderMeta || {
      provider: meta.transcriptionProvider || 'cached',
    },
    provider: meta.transcriptionProvider || meta.transcriptionProviderMeta?.provider || 'cached',
  };
}

/** Processamento assíncrono: arquivo (Google Drive ou vídeo Meta) → transcrição → Gemini → DB. */

module.exports = async function videoTranscriptionProcessor(job) {
  const { mediaId, organizationId, adId } = job.data;
  const actingUserSnapshot = job.data.actingUserSnapshot || null;
  const skipTranscription = Boolean(job.data.skipTranscription);

  const mediaAsset = await db.MediaAsset.findByPk(mediaId);
  if (!mediaAsset) {
    throw new UnrecoverableError('media_not_found');
  }

  const driveFileId = mediaAsset.googleDriveFileId ? String(mediaAsset.googleDriveFileId).trim() : '';
  const metaVid = mediaAsset.metaVideoId ? String(mediaAsset.metaVideoId).trim() : '';

  if (!driveFileId && !metaVid) {
    throw new UnrecoverableError('media_missing_google_drive_file_id_or_meta_video_id');
  }

  const { limits } =
    await planLimitsService.getResolvedLimitsForOrganization(
      organizationId,
      actingUserSnapshot && (actingUserSnapshot.email || actingUserSnapshot.roles?.length)
        ? actingUserSnapshot
        : null,
    );
  const mbCap = Number(limits.max_video_size_mb);
  const maxBytes =
    Number.isFinite(mbCap) && mbCap > 0 ? mbCap * 1024 * 1024 : null;

  await mediaAsset.update({
    processingStatus: skipTranscription ? 'awaiting_ai' : 'transcribing',
    ingestMetadata: {
      ...(mediaAsset.ingestMetadata || {}),
      transcriptionJobId: String(job.id),
      transcriptionStartedAt: new Date().toISOString(),
      transcriptionSource: driveFileId ? 'google_drive' : 'meta_graph_video',
      planLimitsSnapshotUsed: {
        max_video_size_mb: limits.max_video_size_mb,
        max_video_duration_seconds: limits.max_video_duration_seconds,
      },
    },
  });

  await mediaAsset.reload();

  /** @type {Buffer|null} */
  let buffer = null;
  let mimeType = 'video/mp4';
  let fileName = `media_${mediaId}`;
  let metaVideoDurationSeconds = null;

  const cachedTranscript = readCachedTranscript(mediaAsset.ingestMetadata);

  if (!cachedTranscript) {
    try {
      if (driveFileId) {
        const fetched = await googledrive.fetchDriveFileWithBinary(organizationId, driveFileId, {
          maxBytes,
        });
        buffer = fetched.buffer;
        mimeType = fetched.mimeType;
        fileName = fetched.fileName;
      } else {
        const fetched = await metaVideoSource.fetchVideoMp4ViaGraph(organizationId, metaVid);
        buffer = fetched.buffer;
        mimeType = fetched.mimeType;
        fileName = `meta_video_${metaVid}.mp4`;
        metaVideoDurationSeconds =
          fetched.metaVideoDurationSeconds != null ? Number(fetched.metaVideoDurationSeconds) : null;
      }
    } catch (e) {
      if (e.message === 'drive_file_exceeds_plan_max_size') {
        throw new UnrecoverableError(e.message);
      }
      throw e;
    }

    videoGuard.assertVideoWithinPlanGuards({
      buffer,
      limits,
      metaVideoDurationSeconds,
      ingestMetadata: mediaAsset.ingestMetadata,
    });
  }

  /** @type {{ transcript: string, confidence: number|null, durationSeconds: number|null, meta: object, provider: string }} */
  let dg;

  if (cachedTranscript) {
    dg = cachedTranscript;
  } else {
    try {
      dg = await mediaTranscription.transcribeMediaBuffer(buffer, {
        mimeType,
        durationSeconds: metaVideoDurationSeconds,
      });
    } catch (e) {
      if (
        e.message === 'gemini_transcription_file_too_large' ||
        e.message === 'transcription_provider_not_configured'
      ) {
        throw new UnrecoverableError(e.message);
      }
      throw e;
    }
  }

  const durTranscript =
    dg.durationSeconds != null && Number.isFinite(Number(dg.durationSeconds))
      ? Number(dg.durationSeconds)
      : metaVideoDurationSeconds != null && Number.isFinite(Number(metaVideoDurationSeconds))
        ? Number(metaVideoDurationSeconds)
        : null;

  const durLimit = Number(limits.max_video_duration_seconds);
  if (
    durTranscript != null &&
    Number.isFinite(durLimit) &&
    durLimit > 0 &&
    durTranscript > durLimit
  ) {
    throw new UnrecoverableError(
      `video_exceeds_max_duration_seconds:${durLimit}:actual:${durTranscript.toFixed(2)}`,
    );
  }

  const minutesDebited =
    !cachedTranscript && durTranscript != null && durTranscript > 0
      ? Math.max(1, Math.ceil(durTranscript / 60))
      : cachedTranscript
        ? 0
        : 1;

  if (minutesDebited > 0) {
    try {
      await transcriptionUsage.consumeTranscriptionMinutes(
        organizationId,
        minutesDebited,
        actingUserSnapshot && (actingUserSnapshot.email || actingUserSnapshot.roles?.length)
          ? actingUserSnapshot
          : null,
      );
    } catch (quotaErr) {
      if (
        quotaErr &&
        quotaErr.message === 'transcription_minutes_quota_exceeded'
      ) {
        throw new UnrecoverableError(quotaErr.message);
      }
      throw quotaErr;
    }
  }

  await mediaAsset.reload();
  await mediaAsset.update({
    processingStatus: 'awaiting_ai',
    ingestMetadata: {
      ...(mediaAsset.ingestMetadata || {}),
      transcriptFull: dg.transcript,
      transcriptionProvider: dg.provider || dg.meta?.provider || 'unknown',
      transcriptionCharCount: dg.transcript.length,
      transcriptionConfidence: dg.confidence,
      transcriptionProviderMeta: dg.meta,
      transcriptionDeepgramSeconds: durTranscript,
      transcriptionMinutesDebited:
        (mediaAsset.ingestMetadata?.transcriptionMinutesDebited || 0) + minutesDebited,
      transcriptionLocalFileHint: String(fileName).slice(0, 255),
      transcriptionFinishedAt: new Date().toISOString(),
    },
  });

  /** Copy/título/CTA persistidos pelo MetaSync no `ads` (análise holística). */
  let adMetaCopy = { primaryText: '', headline: '', ctaType: '' };
  if (adId) {
    const adRow = await db.Ad.findOne({
      where: { id: adId, organizationId },
    });
    if (adRow) {
      adMetaCopy = {
        primaryText: adRow.primaryText || '',
        headline: adRow.headline || '',
        ctaType: adRow.ctaType || '',
      };
    }
  }

  let insights;
  try {
    insights = await creativeAnalysisService.generateCreativeInsightsHolistic(
      dg.transcript,
      adMetaCopy,
      {},
    );
  } catch (_eInsight) {
    await mediaAsset.update({
      processingStatus: 'failed_ai',
      ingestMetadata: {
        ...(mediaAsset.ingestMetadata || {}),
        lastInsightErrorAt: new Date().toISOString(),
        lastInsightError: _eInsight?.message || String(_eInsight),
      },
    });
    throw _eInsight;
  }

  /** JSON final — notas por dimensão + harmonia vídeo × texto */
  const aiAnalysisPayload = {
    gancho: insights.gancho,
    nota: insights.nota,
    notasDetalhadas: insights.notas,
    harmonia_entre_video_e_texto: insights.harmonia_entre_video_e_texto,
    sugestoes: insights.sugestoes,
    transcript: dg.transcript,
    transcriptSnippet: dg.transcript.slice(0, 512),
    metaCopyUsed: {
      primaryText: String(adMetaCopy.primaryText || '').slice(0, 2000),
      headline: String(adMetaCopy.headline || '').slice(0, 512),
      ctaType: String(adMetaCopy.ctaType || '').slice(0, 128),
    },
    transcriptionProvider: dg.provider || dg.meta?.provider || null,
    deepgramConfidence: dg.confidence,
    llmModel: insights.modelUsed,
    analyzedPipeline: cachedTranscript
      ? 'bullmq_gemini_holistic_cached_transcript_v1'
      : 'bullmq_transcribe_gemini_holistic_v1',
  };
  aiAnalysisPayload.ui = require('../../Services/ai_creative_ui.service').buildAiCreativeUi(
    aiAnalysisPayload,
  );

  await db.CreativeAnalysis.create({
    organizationId,
    adId,
    mediaId,
    performanceSnapshot: {
      transcriptionSummary: {
        provider: dg.provider || dg.meta?.provider || null,
        model: dg.meta?.model || null,
        mimeType,
        chars: dg.transcript.length,
        confidence: dg.confidence,
        durationSeconds: durTranscript,
        billedTranscriptionMinutes: minutesDebited,
        usedCachedTranscript: Boolean(cachedTranscript),
      },
      metaAdCopySnapshot: adMetaCopy,
      sourceFileHint: String(fileName).slice(0, 255),
    },
    aiAnalysis: aiAnalysisPayload,
    analyzedAt: new Date(),
    periodKey: null,
    analysisVersion: 'video_tx_gemini_holistic_v2',
  });

  await mediaAsset.reload();
  await mediaAsset.update({
    processingStatus: 'processed',
    ingestMetadata: {
      ...(mediaAsset.ingestMetadata || {}),
      lastAnalysisModel: insights.modelUsed || null,
      lastAnalysisAt: new Date().toISOString(),
    },
  });

  return {
    mediaId,
    adId,
    transcriptChars: dg.transcript.length,
    minutesDebited,
    usedCachedTranscript: Boolean(cachedTranscript),
    transcriptionProvider: dg.provider || dg.meta?.provider || null,
  };
};
