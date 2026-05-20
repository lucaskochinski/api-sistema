'use strict';

const { Op } = require('sequelize');
const db = require('../Models');

const MIN_DEFAULTS = {
  creative_imports_per_month: 1,
  transcription_minutes_per_month: 0,
  max_video_size_mb: 1,
  max_video_duration_seconds: 30,
};

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function platformAdminJwtRoleKey() {
  return (
    process.env.PLATFORM_ADMIN_JWT_ROLE_KEY || 'hooko_platform_admin'
  ).trim();
}

function platformAdminBypassEmails() {
  const raw = process.env.HOOKO_PLATFORM_ADMIN_EMAILS || '';
  return raw
    .split(/[,;\s]+/g)
    .map(normalizeEmail)
    .filter(Boolean);
}

/**
 * @param {{ email?: string, roles?: string[] } | null | undefined} actor
 * Actor vem típico do JWT (`req.user`); workers passam null.
 */
function isPlatformSuperActor(actor) {
  if (!actor || typeof actor !== 'object') return false;
  const roles = Array.isArray(actor.roles) ? actor.roles : [];
  if (roles.includes(platformAdminJwtRoleKey())) return true;
  const em = normalizeEmail(actor.email || '');
  if (em && platformAdminBypassEmails().includes(em)) return true;
  return false;
}

function zeroLimitsFrozen() {
  return {
    creative_imports_per_month: 0,
    transcription_minutes_per_month: 0,
    max_video_size_mb: 0,
    max_video_duration_seconds: 0,
  };
}

function infinityLimitsBypass() {
  return {
    creative_imports_per_month: Number.POSITIVE_INFINITY,
    transcription_minutes_per_month: Number.POSITIVE_INFINITY,
    max_video_size_mb: Number.POSITIVE_INFINITY,
    max_video_duration_seconds: Number.POSITIVE_INFINITY,
  };
}

function num(v, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return n;
}

function envNum(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  return num(raw, fallback);
}

/** Defaults globais SaaS quando o plano omite valores (fallback operacional apenas). */
function globalFallbackLimits() {
  const creativeDefault = envNum(
    'DEFAULT_CREATIVE_IMPORTS_PER_MONTH',
    envNum('DEFAULT_CAMPAIGN_IMPORTS_PER_MONTH', 5),
  );
  return {
    creative_imports_per_month: creativeDefault,
    transcription_minutes_per_month: envNum(
      'DEFAULT_TRANSCRIPTION_MINUTES_PER_MONTH',
      300,
    ),
    max_video_size_mb: envNum('DEFAULT_MAX_VIDEO_SIZE_MB', 50),
    max_video_duration_seconds: envNum(
      'DEFAULT_MAX_VIDEO_DURATION_SECONDS',
      180,
    ),
  };
}

/** Legado: importação era contada por campanha inteira. */
function resolveLegacyCampaignImportsPerMonth(L) {
  const primary = num(L.campaign_imports_per_month, null);
  if (primary != null) return primary;
  const keys = [
    L.metaCampaignImportsPerMonth,
    L.meta_campaign_imports_per_month,
    L.campaignImportsPerMonth,
    L.campaignsPerMonth,
    L.campaigns_per_month,
  ];
  for (const k of keys) {
    if (k == null) continue;
    const n = Number(k);
    if (Number.isFinite(n) && n >= 0) return Math.floor(n);
  }
  return null;
}

function resolveCreativeImportsPerMonth(L) {
  const primary = num(L.creative_imports_per_month, null);
  if (primary != null) return primary;
  const adAlias = num(L.ad_imports_per_month, null);
  if (adAlias != null) return adAlias;
  return resolveLegacyCampaignImportsPerMonth(L);
}

function mergePlanLimits(planRowLimits) {
  const L = planRowLimits && typeof planRowLimits === 'object' ? planRowLimits : {};
  const g = globalFallbackLimits();
  /** Preserva chaves legadas; canônicos abaixo. */
  const merged = {
    ...L,
    creative_imports_per_month: num(
      resolveCreativeImportsPerMonth(L),
      g.creative_imports_per_month,
    ),
    transcription_minutes_per_month: num(
      L.transcription_minutes_per_month,
      g.transcription_minutes_per_month,
    ),
    max_video_size_mb: num(L.max_video_size_mb, g.max_video_size_mb),
    max_video_duration_seconds: num(
      L.max_video_duration_seconds,
      g.max_video_duration_seconds,
    ),
  };
  for (const key of Object.keys(MIN_DEFAULTS)) {
    if (
      merged[key] != null &&
      Number.isFinite(merged[key]) &&
      merged[key] < MIN_DEFAULTS[key]
    ) {
      merged[key] = MIN_DEFAULTS[key];
    }
  }
  return merged;
}

async function getSubscriptionWithPlan(organizationId) {
  /** Stripe: `trialing` (trial comercial configurado por plano) e `active` liberam quotas. */
  const sub = await db.Subscription.findOne({
    where: {
      organizationId,
      status: { [Op.in]: ['active', 'trialing'] },
    },
    include: [{ model: db.Plan, as: 'plan', required: true }],
    order: [['updatedAt', 'DESC']],
  });
  return sub;
}

/**
 * Limites efetivos da organização conforme actor (bypass Super Admin → infinitos) e assinatura.
 * Sem assinatura ativa: ZERO (bloqueio total).
 * @param {string} organizationId
 * @param {{ email?: string, roles?: string[] } | null} [actor]
 * @returns {Promise<{ limits: object, planId: string|null, tierKey: string|null, limitless: boolean, source: string }>}
 */
async function getResolvedLimitsForOrganization(organizationId, actor = null) {
  if (isPlatformSuperActor(actor)) {
    return {
      limits: infinityLimitsBypass(),
      planId: null,
      tierKey: null,
      limitless: true,
      source: 'platform_admin_bypass',
    };
  }

  const sub = await getSubscriptionWithPlan(organizationId);
  if (!sub || !sub.plan) {
    return {
      limits: zeroLimitsFrozen(),
      planId: null,
      tierKey: null,
      limitless: false,
      source: 'no_active_subscription',
    };
  }

  const limits = mergePlanLimits(sub.plan.limits);
  return {
    limits,
    planId: sub.planId,
    tierKey: sub.plan.tierKey || null,
    limitless: false,
    source: 'subscription',
  };
}

function creativeImportLimitFromResolved(limits) {
  const n =
    limits.creative_imports_per_month ??
    limits.campaign_imports_per_month ??
    limits.ad_imports_per_month;
  if (n === Number.POSITIVE_INFINITY) return Number.POSITIVE_INFINITY;
  return Math.floor(Number(n));
}

/** Alias legado para chamadas antigas ao serviço. */
function campaignImportLimitFromResolved(limits) {
  return creativeImportLimitFromResolved(limits);
}

function transcriptionMinutesLimitFromResolved(limits) {
  const n = limits.transcription_minutes_per_month;
  if (n === Number.POSITIVE_INFINITY) return Number.POSITIVE_INFINITY;
  return Math.floor(Number(n));
}

module.exports = {
  mergePlanLimits,
  getResolvedLimitsForOrganization,
  getSubscriptionWithPlan,
  globalFallbackLimits,
  zeroLimitsFrozen,
  infinityLimitsBypass,
  creativeImportLimitFromResolved,
  campaignImportLimitFromResolved,
  transcriptionMinutesLimitFromResolved,
  isPlatformSuperActor,
  normalizeEmail,
  platformAdminJwtRoleKey,
};
