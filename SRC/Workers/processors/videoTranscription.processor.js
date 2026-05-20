'use strict';

const { UnrecoverableError } = require('bullmq');
const googledrive = require('../../Features/GoogleDrive/googledrive.service');
const metaVideoSource = require('../../Services/meta_video_source.service');
const deepgramService = require('../../Services/deepgram.service');
const creativeAnalysisService = require('../../Services/creative_analysis.service');
const db = require('../../Models');
const planLimitsService = require('../../Services/plan_limits.service');
const videoGuard = require('../../Services/video_plan_guard.service');
const transcriptionUsage = require('../../Services/transcription_usage.service');

/** Processamento assíncrono: arquivo (Google Drive ou vídeo Meta) → Deepgram → Gemini → DB. */

module.exports = async function videoTranscriptionProcessor(job) {
  const { mediaId, organizationId, adId } = job.data;
  const actingUserSnapshot = job.data.actingUserSnapshot || null;

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
    processingStatus: 'transcribing',
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

  /** @type {Buffer} */
  let buffer;
  let mimeType;
  let fileName;
  let metaVideoDurationSeconds = null;

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

  let dg;
  try {
    dg = await deepgramService.transcribeMediaBuffer(buffer, { mimeType });
  } catch (e) {
    /** Erros rede / 5xx Deepgram ficam retratáveis (Bull retry + backoff configurado na fila) */
    throw e;
  }

  const durDeepgram =
    dg.durationSeconds != null && Number.isFinite(Number(dg.durationSeconds))
      ? Number(dg.durationSeconds)
      : null;
  const durLimit = Number(limits.max_video_duration_seconds);
  if (
    durDeepgram != null &&
    Number.isFinite(durLimit) &&
    durLimit > 0 &&
    durDeepgram > durLimit
  ) {
    throw new UnrecoverableError(
      `video_exceeds_max_duration_seconds:${durLimit}:deepgram_actual:${durDeepgram.toFixed(2)}`,
    );
  }

  const minutesDebited =
    durDeepgram != null && durDeepgram > 0
      ? Math.max(1, Math.ceil(durDeepgram / 60))
      : 1;

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

  await mediaAsset.reload();
  await mediaAsset.update({
    processingStatus: 'awaiting_ai',
    ingestMetadata: {
      ...(mediaAsset.ingestMetadata || {}),
      transcriptionCharCount: dg.transcript.length,
      transcriptionProviderMeta: dg.meta,
      transcriptionDeepgramSeconds: durDeepgram,
      transcriptionMinutesDebited: minutesDebited,
      transcriptionLocalFileHint: String(fileName).slice(0, 255),
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
    transcriptSnippet: dg.transcript.slice(0, 512),
    metaCopyUsed: {
      primaryText: String(adMetaCopy.primaryText || '').slice(0, 2000),
      headline: String(adMetaCopy.headline || '').slice(0, 512),
      ctaType: String(adMetaCopy.ctaType || '').slice(0, 128),
    },
    deepgramConfidence: dg.confidence,
    llmModel: insights.modelUsed,
    analyzedPipeline: 'bullmq_deepgram_gemini_holistic_v1',
  };

  await db.CreativeAnalysis.create({
    organizationId,
    adId,
    mediaId,
    performanceSnapshot: {
      transcriptionSummary: {
        provider: 'deepgram',
        model: dg.meta?.model || null,
        mimeType,
        chars: dg.transcript.length,
        confidence: dg.confidence,
        deepgramSeconds: durDeepgram,
        billedTranscriptionMinutes: minutesDebited,
      },
      metaAdCopySnapshot: adMetaCopy,
      sourceFileHint: String(fileName).slice(0, 255),
    },
    aiAnalysis: aiAnalysisPayload,
    analyzedAt: new Date(),
    periodKey: null,
    analysisVersion: 'video_tx_gemini_holistic_v1',
  });

  await mediaAsset.reload();
  await mediaAsset.update({
    processingStatus: 'processed',
    ingestMetadata: {
      ...(mediaAsset.ingestMetadata || {}),
      transcriptionFinishedAt: new Date().toISOString(),
      lastAnalysisModel: insights.modelUsed || null,
    },
  });

  return { mediaId, transcriptChars: dg.transcript.length, minutesDebited };
};
