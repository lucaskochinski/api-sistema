'use strict';

const db = require('../Models');

/** Vitrine inicial — idempotente por `tier_key`. Stripe IDs são placeholders até configurar no admin. */
const DEFAULT_PLANS = [
  {
    tierKey: 'starter',
    displayName: 'HOOKO Starter',
    stripePriceId: 'price_hooko_starter_demo',
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
    stripePriceId: 'price_hooko_pro_demo',
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
    stripePriceId: 'price_hooko_scale_demo',
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
    const [, wasCreated] = await db.Plan.findOrCreate({
      where: { tierKey: spec.tierKey },
      defaults: {
        tierKey: spec.tierKey,
        displayName: spec.displayName,
        stripePriceId: spec.stripePriceId,
        limits: spec.limits,
        trialDays: spec.trialDays,
        isActive: true,
        isPublic: true,
        customOrganizationId: null,
      },
    });

    if (wasCreated) {
      created += 1;
      console.info(`[defaultPlansSeed] plano criado: ${spec.tierKey} (${spec.displayName})`);
    } else {
      skipped += 1;
    }
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
