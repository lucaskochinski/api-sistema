'use strict';

const db = require('../Models');
const metasyncService = require('../Features/MetaSync/metasync.service');

const DEFAULTS = {
  orgSlug: process.env.SEED_SUPER_ADMIN_ORG_SLUG || 'hooko-admin',
  metaActId: process.env.META_SEED_TEST_ACT_ID || '2496055307427709',
  metaCampaignId: process.env.META_SEED_TEST_CAMPAIGN_ID || '120242933545880467',
  metaAdId: process.env.META_SEED_TEST_AD_ID || '120242933568840467',
  adminEmail:
    process.env.SEED_SUPER_ADMIN_EMAIL ||
    process.env.PLATFORM_ADMIN_BYPASS_EMAIL ||
    'admin@admin.com',
  platformRole:
    process.env.PLATFORM_ADMIN_JWT_ROLE_KEY || 'hooko_platform_admin',
};

function seedEnabled() {
  const flag = String(process.env.META_SEED_TEST_AD_ENABLED || 'true').toLowerCase();
  if (flag === 'false' || flag === '0' || flag === 'off') return false;
  return Boolean(String(process.env.META_SYSTEM_ACCESS_TOKEN || '').trim());
}

/**
 * Importa um anúncio Meta com entrega real na org admin (idempotente) para facilitar testes locais.
 */
async function ensureAdminTestAdSeeded() {
  if (!seedEnabled()) {
    console.info('[adminMetaSeed] desabilitado (META_SEED_TEST_AD_ENABLED=false ou sem META_SYSTEM_ACCESS_TOKEN)');
    return null;
  }

  const orgSlug = String(process.env.META_SEED_ORG_SLUG || DEFAULTS.orgSlug).trim();
  const orgIdOverride = String(process.env.META_SEED_ORGANIZATION_ID || '').trim();

  const org = orgIdOverride
    ? await db.Organization.findByPk(orgIdOverride)
    : await db.Organization.findOne({ where: { slug: orgSlug } });
  if (!org) {
    console.warn('[adminMetaSeed] org não encontrada:', orgIdOverride || orgSlug);
    return null;
  }

  const metaAdId = String(process.env.META_SEED_TEST_AD_ID || DEFAULTS.metaAdId).trim();
  const metaCampaignId = String(
    process.env.META_SEED_TEST_CAMPAIGN_ID || DEFAULTS.metaCampaignId,
  ).trim();
  const metaActId = String(process.env.META_SEED_TEST_ACT_ID || DEFAULTS.metaActId).trim();

  const existingAd = await db.Ad.findOne({
    where: { organizationId: org.id, metaAdId },
    attributes: ['id', 'name', 'metaAdId'],
  });

  if (existingAd) {
    const dayCount = await db.AdPerformanceDaily.count({
      where: { organizationId: org.id, adId: existingAd.id },
    });
    if (dayCount > 0) {
      console.info('[adminMetaSeed] anúncio de teste já importado com métricas', {
        org: org.slug || org.id,
        adId: existingAd.id,
        metaAdId,
        dayCount,
      });
      return { skipped: true, adId: existingAd.id, metaAdId, dayCount };
    }
    console.info('[adminMetaSeed] anúncio existe sem métricas — re-sincronizando', {
      adId: existingAd.id,
      metaAdId,
    });
  } else {
    console.info('[adminMetaSeed] importando anúncio de teste para org admin', {
      org: org.slug || org.id,
      metaAdId,
      metaCampaignId,
      metaActId,
    });
  }

  const actingUserProfile = {
    email: String(process.env.META_SEED_ACTOR_EMAIL || DEFAULTS.adminEmail).trim(),
    roles: [DEFAULTS.platformRole],
  };

  try {
    const result = await metasyncService.importAndAnalyzeAd({
      organizationId: org.id,
      metaActIdFromRoute: metaActId,
      metaCampaignGraphId: metaCampaignId,
      metaAdGraphId: metaAdId,
      actingUserProfile,
    });

    const adDbId = result?.structure?.adDbId || existingAd?.id || null;
    const daysWritten = result?.insights?.detailByAdId?.[String(adDbId)]?.daysWritten;

    console.info('[adminMetaSeed] ok', {
      org: org.slug || org.id,
      adDbId,
      metaAdId,
      daysWritten,
      reSync: Boolean(result?.reSyncSkippedCredit),
    });

    return {
      skipped: false,
      adId: adDbId,
      metaAdId,
      daysWritten,
      result,
    };
  } catch (error) {
    console.warn('[adminMetaSeed] falhou (não bloqueia boot):', error?.message || error);
    return null;
  }
}

module.exports = { ensureAdminTestAdSeeded };
