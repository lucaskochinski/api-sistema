'use strict';

const db = require('../Models');
const graph = require('./meta_graph.client');
const metaService = require('../Features/Meta/meta.service');
const metasyncService = require('../Features/MetaSync/metasync.service');
const { runSyncVideoCreativeAnalysis } = require('./sync_creative_analysis.service');
const integrationConfig = require('./integration_config.service');

const DEFAULTS = {
  orgSlug: process.env.SEED_SUPER_ADMIN_ORG_SLUG || 'hooko-admin',
  metaActId: process.env.META_DEMO_AI_ACT_ID || '2496055307427709',
  metaAdId: process.env.META_DEMO_AI_AD_ID || '120244826131880467',
  adminEmail:
    process.env.SEED_SUPER_ADMIN_EMAIL ||
    process.env.PLATFORM_ADMIN_BYPASS_EMAIL ||
    'adminpatrick@gmail.com',
  platformRole:
    process.env.PLATFORM_ADMIN_JWT_ROLE_KEY || 'hooko_platform_admin',
};

function seedEnabled() {
  const flag = String(process.env.META_DEMO_AI_SEED_ENABLED || 'true').toLowerCase();
  if (flag === 'false' || flag === '0' || flag === 'off') return false;

  const gemini =
    integrationConfig.get('gemini_api_key') ||
    process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (!String(gemini || '').trim()) return false;

  const metaToken =
    integrationConfig.get('meta_system_access_token') || process.env.META_SYSTEM_ACCESS_TOKEN;
  return Boolean(String(metaToken || '').trim());
}

/**
 * Importa anúncio de vídeo demo + roda IA síncrona (sem depender do worker Redis).
 * Idempotente: não reprocessa se já existir creative_analyses para o ad.
 */
async function ensureDemoAdAiAnalysisSeeded() {
  if (!seedEnabled()) {
    console.info(
      '[demoAiSeed] desabilitado (META_DEMO_AI_SEED_ENABLED=false, sem GEMINI ou META_SYSTEM_ACCESS_TOKEN)',
    );
    return null;
  }

  const orgIdOverride = String(process.env.META_DEMO_AI_ORGANIZATION_ID || '').trim();
  const orgSlug = String(process.env.META_DEMO_AI_ORG_SLUG || DEFAULTS.orgSlug).trim();
  const org = orgIdOverride
    ? await db.Organization.findByPk(orgIdOverride)
    : await db.Organization.findOne({ where: { slug: orgSlug } });

  if (!org) {
    console.warn('[demoAiSeed] org não encontrada:', orgIdOverride || orgSlug);
    return null;
  }

  const metaAdId = String(process.env.META_DEMO_AI_AD_ID || DEFAULTS.metaAdId).trim();
  const metaActId = String(process.env.META_DEMO_AI_ACT_ID || DEFAULTS.metaActId).trim();
  const force = String(process.env.META_DEMO_AI_FORCE || '').toLowerCase() === 'true';

  let adRow = await db.Ad.findOne({
    where: { organizationId: org.id, metaAdId },
    attributes: ['id', 'name', 'metaAdId', 'metaVideoId'],
  });

  const actingUserProfile = {
    email: String(process.env.META_DEMO_AI_ACTOR_EMAIL || DEFAULTS.adminEmail).trim(),
    roles: [DEFAULTS.platformRole],
  };

  if (!adRow) {
    console.info('[demoAiSeed] importando anúncio Meta', { metaAdId, metaActId, org: org.slug });

    let metaCampaignGraphId = String(process.env.META_DEMO_AI_CAMPAIGN_ID || '').trim();
    if (!metaCampaignGraphId) {
      try {
        const { accessToken } = await metaService.getValidToken(org.id);
        const head = await graph.fbGet(accessToken, metaAdId, { fields: 'campaign_id,account_id,name' });
        metaCampaignGraphId = head?.campaign_id ? String(head.campaign_id) : '';
        if (!metaCampaignGraphId) {
          console.warn('[demoAiSeed] campaign_id não encontrado no Graph para', metaAdId);
          return null;
        }
      } catch (err) {
        console.warn('[demoAiSeed] falha ao resolver campaign_id:', err.message);
        return null;
      }
    }

    try {
      await metasyncService.importAndAnalyzeAd({
        organizationId: org.id,
        metaActIdFromRoute: metaActId,
        metaCampaignGraphId,
        metaAdGraphId: metaAdId,
        actingUserProfile,
      });
    } catch (err) {
      console.warn('[demoAiSeed] import falhou:', err.message);
      adRow = await db.Ad.findOne({
        where: { organizationId: org.id, metaAdId },
        attributes: ['id', 'name', 'metaAdId', 'metaVideoId'],
      });
      if (!adRow) return null;
    }

    adRow = await db.Ad.findOne({
      where: { organizationId: org.id, metaAdId },
      attributes: ['id', 'name', 'metaAdId', 'metaVideoId'],
    });
  }

  if (!adRow) {
    console.warn('[demoAiSeed] anúncio não encontrado após import');
    return null;
  }

  if (!force) {
    const existingAnalysis = await db.CreativeAnalysis.findOne({
      where: { organizationId: org.id, adId: adRow.id },
      order: [['analyzedAt', 'DESC']],
    });
    if (existingAnalysis) {
      const url = `${process.env.PUBLIC_FRONTEND_URL || 'http://localhost:3000'}/criativo/${adRow.id}`;
      console.info('[demoAiSeed] análise IA já existe — abra no front:', {
        adId: adRow.id,
        adName: adRow.name,
        metaAdId,
        creativeAnalysisId: existingAnalysis.id,
        frontendUrl: url,
        organizationId: org.id,
      });
      return {
        skipped: true,
        adId: adRow.id,
        organizationId: org.id,
        creativeAnalysisId: existingAnalysis.id,
        frontendUrl: url,
      };
    }
  }

  const mediaRow = adRow.metaVideoId
    ? await db.MediaAsset.findOne({ where: { metaVideoId: String(adRow.metaVideoId) } })
    : null;

  if (!mediaRow) {
    console.warn('[demoAiSeed] media_asset não encontrado para metaVideoId', adRow.metaVideoId);
    return null;
  }

  await mediaRow.reload();

  console.info('[demoAiSeed] a executar IA síncrona (transcrição + análise Gemini)…', {
    adId: adRow.id,
    mediaId: mediaRow.id,
    metaAdId,
  });

  const hasCachedTranscript = Boolean(
    mediaRow.ingestMetadata?.transcriptFull && String(mediaRow.ingestMetadata.transcriptFull).trim(),
  );

  try {
    const result = await runSyncVideoCreativeAnalysis({
      organizationId: org.id,
      mediaId: mediaRow.id,
      adId: adRow.id,
      actingUserProfile,
      skipTranscription: hasCachedTranscript,
      skipIfAnalysisExists: !force,
      forceRecreate: force,
    });

    const url = `${process.env.PUBLIC_FRONTEND_URL || 'http://localhost:3000'}/criativo/${adRow.id}`;
    console.info('[demoAiSeed] ✅ análise concluída — veja no front:', {
      adId: adRow.id,
      adName: adRow.name,
      metaAdId,
      organizationId: org.id,
      creativeAnalysisId: result.creativeAnalysisId,
      transcriptChars: result.transcriptChars,
      notas: result.notas,
      outputVia: result.outputVia,
      frontendUrl: url,
    });

    return {
      skipped: false,
      adId: adRow.id,
      organizationId: org.id,
      ...result,
      frontendUrl: url,
    };
  } catch (err) {
    console.warn('[demoAiSeed] IA falhou (não bloqueia boot):', err.message || err);
    return null;
  }
}

module.exports = { ensureDemoAdAiAnalysisSeeded };
