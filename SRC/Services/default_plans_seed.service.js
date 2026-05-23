'use strict';

const db = require('../Models');
const stripePlans = require('./stripe_plans.service');

/** Vitrine inicial — idempotente por `tier_key`. Stripe sincronizado automaticamente quando configurado. */
const DEFAULT_PLANS = [
  {
    tierKey: 'starter',
    displayName: 'HOOKO Starter',
    priceAmountCents: 9700,
    trialDays: 7,
    limits: {
      creative_imports_per_month: 50,
      transcription_minutes_per_month: 120,
      max_video_size_mb: 100,
      max_video_duration_seconds: 300,
    },
  },
  {
    tierKey: 'pro',
    displayName: 'HOOKO Pro',
    priceAmountCents: 19700,
    trialDays: 14,
    limits: {
      creative_imports_per_month: 200,
      transcription_minutes_per_month: 600,
      max_video_size_mb: 250,
      max_video_duration_seconds: 600,
    },
  },
  {
    tierKey: 'scale',
    displayName: 'HOOKO Scale',
    priceAmountCents: 49700,
    trialDays: 0,
    limits: {
      creative_imports_per_month: 999999,
      transcription_minutes_per_month: 999999,
      max_video_size_mb: 1024,
      max_video_duration_seconds: 3600,
    },
  },
];

function seedEnabled() {
  const flag = String(process.env.SEED_DEFAULT_PLANS_ENABLED || 'true').toLowerCase();
  return !(flag === 'false' || flag === '0' || flag === 'off');
}

function stripeConfigured() {
  return Boolean(process.env.STRIPE_SECRET_KEY && String(process.env.STRIPE_SECRET_KEY).trim());
}

async function syncPlanStripe(spec) {
  if (!stripeConfigured()) {
    return {
      stripePriceId: `price_hooko_${spec.tierKey}_demo`,
      stripeProductId: null,
      priceAmountCents: spec.priceAmountCents,
      priceCurrency: 'brl',
    };
  }

  const synced = await stripePlans.ensureStripePlan({
    tierKey: spec.tierKey,
    displayName: spec.displayName,
    amountCents: spec.priceAmountCents,
    currency: 'brl',
  });

  return {
    stripePriceId: synced.priceId,
    stripeProductId: synced.productId,
    priceAmountCents: synced.amountCents,
    priceCurrency: synced.currency,
  };
}

/**
 * Garante 3 planos públicos padrão no boot (checkout + `/api/plans/public`).
 * Não sobrescreve planos já existentes com o mesmo `tier_key`.
 */
async function ensureDefaultPlansSeeded() {
  if (!seedEnabled()) {
    console.info('[defaultPlansSeed] desabilitado (SEED_DEFAULT_PLANS_ENABLED=false)');
    return { created: 0, skipped: DEFAULT_PLANS.length };
  }

  let created = 0;
  let skipped = 0;

  for (const spec of DEFAULT_PLANS) {
    const existing = await db.Plan.findOne({ where: { tierKey: spec.tierKey } });
    if (existing) {
      skipped += 1;
      continue;
    }

    const stripe = await syncPlanStripe(spec);

    await db.Plan.create({
      tierKey: spec.tierKey,
      displayName: spec.displayName,
      stripePriceId: stripe.stripePriceId,
      stripeProductId: stripe.stripeProductId,
      priceAmountCents: stripe.priceAmountCents,
      priceCurrency: stripe.priceCurrency,
      limits: spec.limits,
      trialDays: spec.trialDays,
      isActive: true,
      isPublic: true,
      customOrganizationId: null,
    });

    created += 1;
    console.info(`[defaultPlansSeed] plano criado: ${spec.tierKey} (${spec.displayName})`);
  }

  if (created > 0) {
    console.info(`[defaultPlansSeed] ${created} plano(s) criado(s), ${skipped} já existiam`);
  } else {
    console.info('[defaultPlansSeed] planos padrão já presentes');
  }

  return { created, skipped };
}

module.exports = {
  ensureDefaultPlansSeeded,
  DEFAULT_PLANS,
};
